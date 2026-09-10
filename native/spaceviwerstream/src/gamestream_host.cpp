#include "senaistream/gamestream_host.hpp"

#include "management_page.hpp"
#include "senaistream/audio_recorder.hpp"
#include "senaistream/display_catalog.hpp"
#include "senaistream/moonlight_audio_packetizer.hpp"
#include "senaistream/moonlight_video_packetizer.hpp"
#include "senaistream/session_registry.hpp"
#include "senaistream/video_recorder.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <charconv>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <enet/enet.h>
#include <filesystem>
#include <future>
#include <iostream>
#include <iphlpapi.h>
#include <limits>
#include <memory>
#include <mutex>
#include <openssl/evp.h>
#include <openssl/pem.h>
#include <openssl/ssl.h>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <thread>
#include <utility>
#include <vector>
#include <windows.h>
#include <winsock2.h>
#include <ws2tcpip.h>

namespace {

  /**
   * @brief Negotiated secrets and media parameters for the active client.
   */
  struct RuntimeSessionConfig {
    std::array<std::uint8_t, 16> key {};  ///< Ephemeral AES-128 session key.
    std::uint32_t key_id {};  ///< Session key identifier used to derive audio IVs.
    std::uint32_t width {1280};  ///< Requested video width.
    std::uint32_t height {720};  ///< Requested video height.
    std::uint32_t frames_per_second {60};  ///< Requested video frame rate.
    std::uint32_t bitrate_bps {10'000'000};  ///< Requested video bitrate.
    std::uint32_t audio_frame_ms {5};  ///< Requested Opus packet duration.
    bool ready {};  ///< Whether the key and identifier were parsed from launch.
    bool encrypt_audio {};  ///< Whether Moonlight requested encrypted audio.
  };

  /**
   * @brief Maps absolute Moonlight pointer coordinates into one Windows display.
   */
  struct InputViewport {
    std::int32_t left {};  ///< Display left coordinate in the virtual desktop.
    std::int32_t top {};  ///< Display top coordinate in the virtual desktop.
    std::uint32_t width {};  ///< Display width in pixels.
    std::uint32_t height {};  ///< Display height in pixels.
    bool active {};  ///< Whether the mapping describes the active stream display.
  };

  /** @brief Owns one client's secrets, control channel and cancellable media pipelines. */
  struct RuntimeSession {
    RuntimeSessionConfig config;  ///< Negotiated secrets, protected by mutex.
    std::mutex mutex;  ///< Serializes negotiation updates.
    std::mutex input_mutex;  ///< Guards the capture viewport.
    InputViewport viewport;  ///< Input mapping for this client only.
    std::atomic_bool stop {};  ///< Stops only this client's audio and video.
    std::atomic_bool restart_video {};  ///< Reopens capture without dropping control/audio.
    std::atomic_bool active {};  ///< Authenticated ENet connection established.
    std::atomic_uint64_t frames {};  ///< Actual emitted video frames.
    std::atomic_uint64_t bytes {};  ///< Actual emitted video payload bytes.
    std::atomic_int selected_display {-1};  ///< Optional display override for this client.
    std::atomic_uint32_t display {};  ///< Actual selected capture display.
    std::atomic_uint32_t width {}, height {};  ///< Actual encoded resolution.
    std::string client_certificate;  ///< Authorized identity used for revocation and resume.
    ENetPeer *control_peer {};  ///< Accessed exclusively by the host event loop.
    std::thread video, audio;  ///< Independent producer threads.
    std::chrono::steady_clock::time_point created {std::chrono::steady_clock::now()};  ///< Admission deadline.

    /** @brief Cancels and joins producers before releasing session state. */
    ~RuntimeSession() {
      stop.store(true);
      if (video.joinable()) {
        video.join();
      }
      if (audio.joinable()) {
        audio.join();
      }
    }
  };

  /** @brief Converts an IPv4 transport peer into a routing key.
   * @param address Socket address. @return IP text, or empty for unsupported addresses.
   */
  std::string peer_address(const sockaddr_storage &address) {
    if (address.ss_family != AF_INET) {
      return {};
    }
    char text[INET_ADDRSTRLEN] {};
    const auto &ipv4 = reinterpret_cast<const sockaddr_in &>(address);
    return inet_ntop(AF_INET, &ipv4.sin_addr, text, sizeof(text)) ? text : "";
  }

  /**
   * @brief Finds a usable IPv4 address on an active non-loopback adapter.
   *
   * @return Private or LAN IPv4 text, falling back to loopback.
   */
  std::string local_lan_address() {
    ULONG size = 16 * 1024;
    std::vector<std::uint8_t> storage(size);
    auto *adapters = reinterpret_cast<IP_ADAPTER_ADDRESSES *>(storage.data());
    auto result = GetAdaptersAddresses(
      AF_INET,
      GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER,
      nullptr,
      adapters,
      &size
    );
    if (result == ERROR_BUFFER_OVERFLOW) {
      storage.resize(size);
      adapters = reinterpret_cast<IP_ADAPTER_ADDRESSES *>(storage.data());
      result = GetAdaptersAddresses(
        AF_INET,
        GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER,
        nullptr,
        adapters,
        &size
      );
    }
    if (result != NO_ERROR) {
      return "127.0.0.1";
    }
    sockaddr_in route_probe {};
    route_probe.sin_family = AF_INET;
    route_probe.sin_addr.s_addr = htonl(0x08080808U);
    DWORD preferred_interface = 0;
    GetBestInterfaceEx(reinterpret_cast<sockaddr *>(&route_probe), &preferred_interface);
    std::string gateway_candidate;
    std::string fallback;
    for (auto *adapter = adapters; adapter != nullptr; adapter = adapter->Next) {
      if (adapter->OperStatus != IfOperStatusUp || adapter->IfType == IF_TYPE_SOFTWARE_LOOPBACK) {
        continue;
      }
      for (auto *address = adapter->FirstUnicastAddress; address != nullptr; address = address->Next) {
        if (address->Address.lpSockaddr == nullptr || address->Address.lpSockaddr->sa_family != AF_INET) {
          continue;
        }
        const auto *ipv4 = reinterpret_cast<const sockaddr_in *>(address->Address.lpSockaddr);
        const auto host_value = ntohl(ipv4->sin_addr.s_addr);
        if ((host_value & 0xFFFF0000U) == 0xA9FE0000U || (host_value & 0xFF000000U) == 0x7F000000U) {
          continue;
        }
        const auto *bytes = reinterpret_cast<const std::uint8_t *>(&ipv4->sin_addr.s_addr);
        const auto candidate = std::to_string(bytes[0]) + "." + std::to_string(bytes[1]) + "." +
                               std::to_string(bytes[2]) + "." + std::to_string(bytes[3]);
        if (adapter->IfIndex == preferred_interface) {
          return candidate;
        }
        if (gateway_candidate.empty() && adapter->FirstGatewayAddress != nullptr) {
          gateway_candidate = candidate;
        }
        if (fallback.empty()) {
          fallback = candidate;
        }
      }
    }
    return !gateway_candidate.empty() ? gateway_candidate : (fallback.empty() ? "127.0.0.1" : fallback);
  }

  /**
   * @brief Owns a Winsock initialization.
   */
  class WinsockRuntime {
  public:
    /**
     * @brief Initializes Winsock 2.2.
     */
    WinsockRuntime() {
      result_ = WSAStartup(MAKEWORD(2, 2), &data_);
    }

    /**
     * @brief Balances a successful Winsock initialization.
     */
    ~WinsockRuntime() {
      if (result_ == 0) {
        WSACleanup();
      }
    }

    WinsockRuntime(const WinsockRuntime &) = delete;
    WinsockRuntime &operator=(const WinsockRuntime &) = delete;

    /**
     * @brief Returns the Winsock initialization result.
     *
     * @return Zero on success or a Winsock error code.
     */
    [[nodiscard]] int result() const noexcept {
      return result_;
    }

  private:
    WSADATA data_ {};  ///< Negotiated Winsock data.
    int result_ {WSASYSNOTREADY};  ///< Winsock initialization result.
  };

  /**
   * @brief Owns ENet process-wide initialization.
   */
  class EnetRuntime {
  public:
    /**
     * @brief Initializes ENet.
     */
    EnetRuntime():
        result_(enet_initialize()) {
    }

    /**
     * @brief Releases ENet when initialization succeeded.
     */
    ~EnetRuntime() {
      if (result_ == 0) {
        enet_deinitialize();
      }
    }

    EnetRuntime(const EnetRuntime &) = delete;
    EnetRuntime &operator=(const EnetRuntime &) = delete;

    /**
     * @brief Returns the ENet initialization result.
     *
     * @return Zero on success.
     */
    [[nodiscard]] int result() const noexcept {
      return result_;
    }

  private:
    int result_ {-1};  ///< ENet initialization status.
  };

  /**
   * @brief Releases an ENet host.
   */
  struct EnetHostDeleter {
    /**
     * @brief Destroys an ENet host.
     *
     * @param value Host to destroy.
     */
    void operator()(ENetHost *value) const noexcept {
      if (value != nullptr) {
        enet_host_destroy(value);
      }
    }
  };

  /**
   * @brief Owns a Winsock socket handle.
   */
  class SocketHandle {
  public:
    /**
     * @brief Initializes an invalid socket owner.
     */
    SocketHandle() = default;

    /**
     * @brief Takes ownership of a socket.
     *
     * @param value Socket to own.
     */
    explicit SocketHandle(SOCKET value):
        value_(value) {
    }

    /**
     * @brief Closes the owned socket.
     */
    ~SocketHandle() {
      if (value_ != INVALID_SOCKET) {
        closesocket(value_);
      }
    }

    SocketHandle(const SocketHandle &) = delete;
    SocketHandle &operator=(const SocketHandle &) = delete;

    /**
     * @brief Transfers ownership from another socket owner.
     *
     * @param other Socket owner to empty.
     */
    SocketHandle(SocketHandle &&other) noexcept:
        value_(std::exchange(other.value_, INVALID_SOCKET)) {
    }

    /**
     * @brief Replaces this socket with ownership transferred from another owner.
     *
     * @param other Socket owner to empty.
     * @return This socket owner.
     */
    SocketHandle &operator=(SocketHandle &&other) noexcept {
      if (this != &other) {
        if (value_ != INVALID_SOCKET) {
          closesocket(value_);
        }
        value_ = std::exchange(other.value_, INVALID_SOCKET);
      }
      return *this;
    }

    /**
     * @brief Returns the native socket.
     *
     * @return Native socket handle.
     */
    [[nodiscard]] SOCKET get() const noexcept {
      return value_;
    }

  private:
    SOCKET value_ {INVALID_SOCKET};  ///< Owned socket.
  };

  /**
   * @brief Releases an OpenSSL server context.
   */
  struct SslContextDeleter {
    /**
     * @brief Releases a TLS context.
     *
     * @param value Context to release.
     */
    void operator()(SSL_CTX *value) const noexcept {
      SSL_CTX_free(value);
    }
  };

  /**
   * @brief Releases an OpenSSL connection.
   */
  struct SslDeleter {
    /**
     * @brief Releases a TLS connection.
     *
     * @param value Connection to release.
     */
    void operator()(SSL *value) const noexcept {
      SSL_free(value);
    }
  };

  /**
   * @brief Escapes text for XML element content.
   *
   * @param value Plain text.
   * @return XML-safe text.
   */
  std::string escape_xml(std::string_view value) {
    std::string escaped;
    escaped.reserve(value.size());
    for (const char character : value) {
      switch (character) {
        case '&':
          escaped += "&amp;";
          break;
        case '<':
          escaped += "&lt;";
          break;
        case '>':
          escaped += "&gt;";
          break;
        case '\"':
          escaped += "&quot;";
          break;
        case '\'':
          escaped += "&apos;";
          break;
        default:
          escaped += character;
          break;
      }
    }
    return escaped;
  }

  /**
   * @brief Computes a deterministic 64-bit FNV-1a value.
   *
   * @param value Input bytes.
   * @return Hash value.
   */
  std::uint64_t fnv1a(std::string_view value) {
    std::uint64_t hash = 14695981039346656037ULL;
    for (const auto character : value) {
      hash ^= static_cast<std::uint8_t>(character);
      hash *= 1099511628211ULL;
    }
    return hash;
  }

  /**
   * @brief Returns the request target from an HTTP request line.
   *
   * @param request Raw HTTP request headers.
   * @return Request target or an empty view for a malformed request.
   */
  std::string_view request_target(std::string_view request) {
    const auto method_end = request.find(' ');
    if (method_end == std::string_view::npos) {
      return {};
    }
    const auto target_end = request.find(' ', method_end + 1);
    if (target_end == std::string_view::npos) {
      return {};
    }
    return request.substr(method_end + 1, target_end - method_end - 1);
  }

  /**
   * @brief Returns one URL query value without percent decoding.
   *
   * GameStream session parameters used here are decimal or hexadecimal ASCII and
   * therefore never require percent decoding.
   *
   * @param target HTTP request target.
   * @param name Parameter name.
   * @return Parameter value or an empty view when absent.
   */
  std::string_view query_value(std::string_view target, std::string_view name) {
    const auto query = target.find('?');
    if (query == std::string_view::npos) {
      return {};
    }
    std::size_t position = query + 1;
    while (position < target.size()) {
      const auto end = target.find('&', position);
      const auto field = target.substr(position, end == std::string_view::npos ? target.size() - position : end - position);
      const auto equals = field.find('=');
      if (equals != std::string_view::npos && field.substr(0, equals) == name) {
        return field.substr(equals + 1);
      }
      if (end == std::string_view::npos) {
        break;
      }
      position = end + 1;
    }
    return {};
  }

  /**
   * @brief Parses an unsigned decimal integer from a complete string.
   *
   * @param text Decimal text.
   * @param value Receives the parsed value.
   * @return True when the complete text was valid.
   */
  bool parse_decimal(std::string_view text, std::uint32_t &value) {
    const auto result = std::from_chars(text.data(), text.data() + text.size(), value);
    return result.ec == std::errc {} && result.ptr == text.data() + text.size();
  }

  /**
   * @brief Parses Moonlight's signed decimal key identifier without losing bits.
   *
   * @param text Signed decimal text from the launch URL.
   * @param value Receives the original 32-bit representation.
   * @return True when the value fits a signed 32-bit integer.
   */
  bool parse_key_id(std::string_view text, std::uint32_t &value) {
    std::int64_t signed_value = 0;
    const auto result = std::from_chars(text.data(), text.data() + text.size(), signed_value);
    if (result.ec != std::errc {} || result.ptr != text.data() + text.size() || signed_value < std::numeric_limits<std::int32_t>::min() || signed_value > std::numeric_limits<std::int32_t>::max()) {
      return false;
    }
    value = static_cast<std::uint32_t>(static_cast<std::int32_t>(signed_value));
    return true;
  }

  /**
   * @brief Parses a 16-byte lowercase or uppercase hexadecimal key.
   *
   * @param text Thirty-two hexadecimal characters.
   * @param key Receives decoded bytes.
   * @return True when the key was valid.
   */
  bool parse_aes_key(std::string_view text, std::array<std::uint8_t, 16> &key) {
    if (text.size() != key.size() * 2) {
      return false;
    }
    const auto nibble = [](char value) -> int {
      if (value >= '0' && value <= '9') {
        return value - '0';
      }
      if (value >= 'a' && value <= 'f') {
        return value - 'a' + 10;
      }
      if (value >= 'A' && value <= 'F') {
        return value - 'A' + 10;
      }
      return -1;
    };
    for (std::size_t index = 0; index < key.size(); ++index) {
      const auto high = nibble(text[index * 2]);
      const auto low = nibble(text[index * 2 + 1]);
      if (high < 0 || low < 0) {
        return false;
      }
      key[index] = static_cast<std::uint8_t>((high << 4) | low);
    }
    return true;
  }

  /**
   * @brief Parses launch secrets and requested display mode.
   *
   * @param target Authorized GameStream launch target.
   * @param config Receives the parsed session values.
   * @return True when mandatory security values were present and valid.
   */
  bool parse_launch_config(std::string_view target, RuntimeSessionConfig &config) {
    RuntimeSessionConfig parsed;
    if (!parse_aes_key(query_value(target, "rikey"), parsed.key) || !parse_key_id(query_value(target, "rikeyid"), parsed.key_id)) {
      return false;
    }
    const auto mode = query_value(target, "mode");
    const auto first_x = mode.find('x');
    const auto second_x = first_x == std::string_view::npos ? std::string_view::npos : mode.find('x', first_x + 1);
    if (first_x != std::string_view::npos && second_x != std::string_view::npos) {
      std::uint32_t width = 0;
      std::uint32_t height = 0;
      std::uint32_t frames_per_second = 0;
      if (parse_decimal(mode.substr(0, first_x), width) && parse_decimal(mode.substr(first_x + 1, second_x - first_x - 1), height) && parse_decimal(mode.substr(second_x + 1), frames_per_second) && width >= 320 && height >= 240 && frames_per_second >= 1 && frames_per_second <= 240 && width % 2 == 0 && height % 2 == 0) {
        parsed.width = width;
        parsed.height = height;
        parsed.frames_per_second = frames_per_second;
      }
    }
    parsed.ready = true;
    config = parsed;
    return true;
  }

  /**
   * @brief Returns one textual SDP attribute value.
   *
   * @param request RTSP request containing an SDP body.
   * @param name Attribute name without the `a=` prefix or colon.
   * @return Trimmed attribute value.
   */
  std::string_view sdp_attribute(std::string_view request, std::string_view name) {
    const std::string marker = "a=" + std::string(name) + ":";
    const auto start = request.find(marker);
    if (start == std::string_view::npos) {
      return {};
    }
    const auto value_start = start + marker.size();
    const auto end = request.find("\r\n", value_start);
    return request.substr(value_start, end == std::string_view::npos ? request.size() - value_start : end - value_start);
  }

  /**
   * @brief Loads a little-endian 16-bit integer from unaligned bytes.
   *
   * @param source Source bytes.
   * @return Decoded value.
   */
  std::uint16_t load_le16(const std::uint8_t *source) {
    return static_cast<std::uint16_t>(source[0] | (static_cast<std::uint16_t>(source[1]) << 8));
  }

  /**
   * @brief Loads a little-endian 32-bit integer from unaligned bytes.
   *
   * @param source Source bytes.
   * @return Decoded value.
   */
  std::uint32_t load_le32(const std::uint8_t *source) {
    return static_cast<std::uint32_t>(source[0]) | (static_cast<std::uint32_t>(source[1]) << 8) |
           (static_cast<std::uint32_t>(source[2]) << 16) | (static_cast<std::uint32_t>(source[3]) << 24);
  }

  /**
   * @brief Loads a big-endian 16-bit integer from unaligned bytes.
   *
   * @param source Source bytes.
   * @return Decoded value.
   */
  std::uint16_t load_be16(const std::uint8_t *source) {
    return static_cast<std::uint16_t>((static_cast<std::uint16_t>(source[0]) << 8) | source[1]);
  }

  /**
   * @brief Decrypts one legacy Gen-7 Moonlight ENet control envelope.
   *
   * @param packet Encrypted ENet payload.
   * @param key Active AES session key.
   * @return V2 plaintext header and payload, or no value for invalid authentication.
   */
  std::optional<std::vector<std::uint8_t>> decrypt_control_packet(
    std::span<const std::uint8_t> packet,
    const std::array<std::uint8_t, 16> &key
  ) {
    constexpr std::size_t envelope_size = 24;
    if (packet.size() < envelope_size || load_le16(packet.data()) != 1 || static_cast<std::size_t>(load_le16(packet.data() + 2)) + 4 != packet.size()) {
      return std::nullopt;
    }
    std::array<std::uint8_t, 16> iv {};
    iv[0] = static_cast<std::uint8_t>(load_le32(packet.data() + 4));
    const auto ciphertext_size = packet.size() - envelope_size;
    std::vector<std::uint8_t> plaintext(ciphertext_size);
    std::unique_ptr<EVP_CIPHER_CTX, decltype(&EVP_CIPHER_CTX_free)> context(EVP_CIPHER_CTX_new(), EVP_CIPHER_CTX_free);
    if (!context || EVP_DecryptInit_ex(context.get(), EVP_aes_128_gcm(), nullptr, nullptr, nullptr) != 1 || EVP_CIPHER_CTX_ctrl(context.get(), EVP_CTRL_GCM_SET_IVLEN, static_cast<int>(iv.size()), nullptr) != 1 || EVP_DecryptInit_ex(context.get(), nullptr, nullptr, key.data(), iv.data()) != 1) {
      return std::nullopt;
    }
    int written = 0;
    if (EVP_DecryptUpdate(context.get(), plaintext.data(), &written, packet.data() + envelope_size, static_cast<int>(ciphertext_size)) != 1 || EVP_CIPHER_CTX_ctrl(context.get(), EVP_CTRL_GCM_SET_TAG, 16, const_cast<std::uint8_t *>(packet.data() + 8)) != 1) {
      return std::nullopt;
    }
    int final_size = 0;
    if (EVP_DecryptFinal_ex(context.get(), plaintext.data() + written, &final_size) != 1) {
      return std::nullopt;
    }
    plaintext.resize(static_cast<std::size_t>(written + final_size));
    return plaintext;
  }

  /**
   * @brief Encrypts one Opus packet using Moonlight's audio-session IV scheme.
   *
   * @param opus Plain Opus bytes.
   * @param key Active AES-128 session key.
   * @param key_id Launch key identifier.
   * @param sequence RTP sequence number for this packet.
   * @return PKCS#7-padded AES-CBC ciphertext, or no value on failure.
   */
  std::optional<std::vector<std::uint8_t>> encrypt_audio_frame(
    std::span<const std::uint8_t> opus,
    const std::array<std::uint8_t, 16> &key,
    std::uint32_t key_id,
    std::uint16_t sequence
  ) {
    std::array<std::uint8_t, 16> iv {};
    const auto iv_number = key_id + sequence;
    iv[0] = static_cast<std::uint8_t>(iv_number >> 24);
    iv[1] = static_cast<std::uint8_t>(iv_number >> 16);
    iv[2] = static_cast<std::uint8_t>(iv_number >> 8);
    iv[3] = static_cast<std::uint8_t>(iv_number);
    std::unique_ptr<EVP_CIPHER_CTX, decltype(&EVP_CIPHER_CTX_free)> context(EVP_CIPHER_CTX_new(), EVP_CIPHER_CTX_free);
    if (!context || EVP_EncryptInit_ex(context.get(), EVP_aes_128_cbc(), nullptr, key.data(), iv.data()) != 1) {
      return std::nullopt;
    }
    std::vector<std::uint8_t> encrypted(opus.size() + 16);
    int written = 0;
    if (EVP_EncryptUpdate(context.get(), encrypted.data(), &written, opus.data(), static_cast<int>(opus.size())) != 1) {
      return std::nullopt;
    }
    int final_size = 0;
    if (EVP_EncryptFinal_ex(context.get(), encrypted.data() + written, &final_size) != 1) {
      return std::nullopt;
    }
    encrypted.resize(static_cast<std::size_t>(written + final_size));
    return encrypted;
  }

  /**
   * @brief Injects a decoded Moonlight keyboard or mouse input record.
   *
   * @param packet Complete NV input record beginning with its big-endian size.
   * @param viewport Active stream display for absolute pointer mapping.
   * @return True when the record was recognized and submitted.
   */
  bool inject_win32_input(std::span<const std::uint8_t> packet, const InputViewport &viewport) {
    if (packet.size() < 8 || static_cast<std::size_t>(ntohl(load_le32(packet.data()))) + 4 > packet.size()) {
      return false;
    }
    const auto magic = load_le32(packet.data() + 4);
    INPUT input {};
    if ((magic == 3 || magic == 4) && packet.size() >= 14) {
      input.type = INPUT_KEYBOARD;
      input.ki.wVk = load_le16(packet.data() + 9);
      input.ki.dwFlags = magic == 4 ? KEYEVENTF_KEYUP : 0;
    } else if (magic == 7 && packet.size() >= 12) {
      input.type = INPUT_MOUSE;
      input.mi.dx = static_cast<std::int16_t>(load_be16(packet.data() + 8));
      input.mi.dy = static_cast<std::int16_t>(load_be16(packet.data() + 10));
      input.mi.dwFlags = MOUSEEVENTF_MOVE;
    } else if (magic == 5 && packet.size() >= 18) {
      const auto x = load_be16(packet.data() + 8);
      const auto y = load_be16(packet.data() + 10);
      const auto width = std::max<std::uint16_t>(1, load_be16(packet.data() + 14));
      const auto height = std::max<std::uint16_t>(1, load_be16(packet.data() + 16));
      input.type = INPUT_MOUSE;
      if (viewport.active) {
        const auto virtual_left = GetSystemMetrics(SM_XVIRTUALSCREEN);
        const auto virtual_top = GetSystemMetrics(SM_YVIRTUALSCREEN);
        const auto virtual_width = std::max(1, GetSystemMetrics(SM_CXVIRTUALSCREEN));
        const auto virtual_height = std::max(1, GetSystemMetrics(SM_CYVIRTUALSCREEN));
        const auto desktop_x = static_cast<std::int64_t>(viewport.left) +
                               (static_cast<std::uint64_t>(x) * std::max<std::uint32_t>(1, viewport.width - 1)) / width;
        const auto desktop_y = static_cast<std::int64_t>(viewport.top) +
                               (static_cast<std::uint64_t>(y) * std::max<std::uint32_t>(1, viewport.height - 1)) / height;
        input.mi.dx = static_cast<LONG>(std::clamp<std::int64_t>(
          ((desktop_x - virtual_left) * 65'535) / std::max(1, virtual_width - 1),
          0,
          65'535
        ));
        input.mi.dy = static_cast<LONG>(std::clamp<std::int64_t>(
          ((desktop_y - virtual_top) * 65'535) / std::max(1, virtual_height - 1),
          0,
          65'535
        ));
      } else {
        input.mi.dx = static_cast<LONG>((static_cast<std::uint64_t>(x) * 65'535) / width);
        input.mi.dy = static_cast<LONG>((static_cast<std::uint64_t>(y) * 65'535) / height);
      }
      input.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
    } else if ((magic == 8 || magic == 9) && packet.size() >= 9) {
      constexpr std::array<DWORD, 5> down_flags {
        MOUSEEVENTF_LEFTDOWN,
        MOUSEEVENTF_MIDDLEDOWN,
        MOUSEEVENTF_RIGHTDOWN,
        MOUSEEVENTF_XDOWN,
        MOUSEEVENTF_XDOWN
      };
      constexpr std::array<DWORD, 5> up_flags {
        MOUSEEVENTF_LEFTUP,
        MOUSEEVENTF_MIDDLEUP,
        MOUSEEVENTF_RIGHTUP,
        MOUSEEVENTF_XUP,
        MOUSEEVENTF_XUP
      };
      const auto button = packet[8];
      if (button < 1 || button > down_flags.size()) {
        return false;
      }
      input.type = INPUT_MOUSE;
      input.mi.dwFlags = magic == 8 ? down_flags[button - 1] : up_flags[button - 1];
      if (button >= 4) {
        input.mi.mouseData = button == 4 ? XBUTTON1 : XBUTTON2;
      }
    } else if (magic == 10 && packet.size() >= 10) {
      input.type = INPUT_MOUSE;
      input.mi.mouseData = static_cast<DWORD>(static_cast<std::int16_t>(load_be16(packet.data() + 8)));
      input.mi.dwFlags = MOUSEEVENTF_WHEEL;
    } else {
      return false;
    }
    return SendInput(1, &input, sizeof(input)) == 1;
  }

  /**
   * @brief Sends all bytes in a response.
   *
   * @param socket Connected client socket.
   * @param response Complete HTTP response.
   * @return True when all bytes were sent.
   */
  bool send_all(SOCKET socket, std::string_view response) {
    std::size_t sent = 0;
    while (sent < response.size()) {
      const auto count = send(socket, response.data() + sent, static_cast<int>(response.size() - sent), 0);
      if (count == SOCKET_ERROR || count == 0) {
        return false;
      }
      sent += static_cast<std::size_t>(count);
    }
    return true;
  }

  /**
   * @brief Sends all response bytes over TLS.
   *
   * @param connection Established TLS connection.
   * @param response Complete HTTP response.
   * @return True when all bytes were sent.
   */
  bool ssl_send_all(SSL *connection, std::string_view response) {
    std::size_t sent = 0;
    while (sent < response.size()) {
      const auto count = SSL_write(connection, response.data() + sent, static_cast<int>(response.size() - sent));
      if (count <= 0) {
        return false;
      }
      sent += static_cast<std::size_t>(count);
    }
    return true;
  }

  /**
   * @brief Accepts any presented self-signed certificate during the pairing transition.
   *
   * Endpoint authorization remains enforced by the paired-certificate store.
   *
   * @param verified_result OpenSSL chain verification result.
   * @param context Verification context.
   * @return One to continue the TLS handshake.
   */
  int allow_pairing_certificate(int verified_result, X509_STORE_CTX *context) {
    static_cast<void>(verified_result);
    static_cast<void>(context);
    return 1;
  }

  /**
   * @brief Creates a listening TCP socket.
   *
   * @param port Local TCP port.
   * @return Listening socket or INVALID_SOCKET.
   */
  SOCKET create_listener(std::uint16_t port) {
    const auto listener = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listener == INVALID_SOCKET) {
      return INVALID_SOCKET;
    }
    BOOL reuse_address = TRUE;
    setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<const char *>(&reuse_address), sizeof(reuse_address));
    sockaddr_in address {};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_ANY);
    address.sin_port = htons(port);
    if (bind(listener, reinterpret_cast<const sockaddr *>(&address), sizeof(address)) == SOCKET_ERROR || listen(listener, SOMAXCONN) == SOCKET_ERROR) {
      closesocket(listener);
      return INVALID_SOCKET;
    }
    return listener;
  }

  /**
   * @brief Creates a TCP listener reachable only from the local computer.
   *
   * @param port Local TCP port.
   * @return Listening socket or INVALID_SOCKET.
   */
  SOCKET create_loopback_listener(std::uint16_t port) {
    const auto listener = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listener == INVALID_SOCKET) {
      return INVALID_SOCKET;
    }
    BOOL reuse_address = TRUE;
    setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<const char *>(&reuse_address), sizeof(reuse_address));
    sockaddr_in address {};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    address.sin_port = htons(port);
    if (bind(listener, reinterpret_cast<const sockaddr *>(&address), sizeof(address)) == SOCKET_ERROR || listen(listener, SOMAXCONN) == SOCKET_ERROR) {
      closesocket(listener);
      return INVALID_SOCKET;
    }
    return listener;
  }

  /**
   * @brief Creates a UDP socket bound to every IPv4 interface.
   *
   * @param port Port to bind.
   * @return Bound socket or INVALID_SOCKET on failure.
   */
  SOCKET create_udp_listener(std::uint16_t port) {
    const auto listener = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (listener == INVALID_SOCKET) {
      return INVALID_SOCKET;
    }
    sockaddr_in address {};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_ANY);
    address.sin_port = htons(port);
    if (bind(listener, reinterpret_cast<const sockaddr *>(&address), sizeof(address)) == SOCKET_ERROR) {
      closesocket(listener);
      return INVALID_SOCKET;
    }
    return listener;
  }

  /**
   * @brief Creates a TLS server context from in-memory PEM material.
   *
   * @param certificate_pem Host certificate PEM.
   * @param private_key_pem Host private-key PEM.
   * @return TLS context or null on failure.
   */
  std::unique_ptr<SSL_CTX, SslContextDeleter> create_tls_context(
    const std::string &certificate_pem,
    const std::string &private_key_pem
  ) {
    std::unique_ptr<SSL_CTX, SslContextDeleter> context(SSL_CTX_new(TLS_server_method()));
    if (!context) {
      return {};
    }
    std::unique_ptr<BIO, decltype(&BIO_free)> certificate_bio(
      BIO_new_mem_buf(certificate_pem.data(), static_cast<int>(certificate_pem.size())),
      BIO_free
    );
    std::unique_ptr<BIO, decltype(&BIO_free)> key_bio(
      BIO_new_mem_buf(private_key_pem.data(), static_cast<int>(private_key_pem.size())),
      BIO_free
    );
    std::unique_ptr<X509, decltype(&X509_free)> certificate(
      certificate_bio ? PEM_read_bio_X509(certificate_bio.get(), nullptr, nullptr, nullptr) : nullptr,
      X509_free
    );
    std::unique_ptr<EVP_PKEY, decltype(&EVP_PKEY_free)> key(
      key_bio ? PEM_read_bio_PrivateKey(key_bio.get(), nullptr, nullptr, nullptr) : nullptr,
      EVP_PKEY_free
    );
    if (!certificate || !key || SSL_CTX_use_certificate(context.get(), certificate.get()) != 1 || SSL_CTX_use_PrivateKey(context.get(), key.get()) != 1 || SSL_CTX_check_private_key(context.get()) != 1) {
      return {};
    }
    SSL_CTX_set_min_proto_version(context.get(), TLS1_2_VERSION);
    SSL_CTX_set_verify(context.get(), SSL_VERIFY_PEER | SSL_VERIFY_CLIENT_ONCE, allow_pairing_certificate);
    SSL_CTX_set_verify_depth(context.get(), 1);
    return context;
  }

  /**
   * @brief Encodes a peer certificate as PEM.
   *
   * @param certificate Peer certificate.
   * @return PEM text or empty text on failure.
   */
  std::string peer_certificate_pem(X509 *certificate) {
    if (certificate == nullptr) {
      return {};
    }
    std::unique_ptr<BIO, decltype(&BIO_free)> bio(BIO_new(BIO_s_mem()), BIO_free);
    if (!bio || PEM_write_bio_X509(bio.get(), certificate) != 1) {
      return {};
    }
    BUF_MEM *memory = nullptr;
    BIO_get_mem_ptr(bio.get(), &memory);
    return memory == nullptr ? std::string {} : std::string(memory->data, memory->length);
  }

  /**
   * @brief Builds an HTTP response that closes its connection.
   *
   * @param status HTTP status line value.
   * @param content_type MIME type.
   * @param body Response body.
   * @return Complete HTTP response bytes.
   */
  std::string http_response(std::string_view status, std::string_view content_type, std::string_view body) {
    std::ostringstream output;
    output << "HTTP/1.1 " << status << "\r\n"
           << "Content-Type: " << content_type << "\r\n"
           << "Content-Length: " << body.size() << "\r\n"
           << "Connection: close\r\n"
           << "Cache-Control: no-store\r\n\r\n"
           << body;
    return output.str();
  }

  /**
   * @brief Returns the payload portion of an HTTP request.
   *
   * @param request Complete or single-buffer HTTP request.
   * @return Body following the header delimiter.
   */
  std::string_view http_body(std::string_view request) {
    const auto delimiter = request.find("\r\n\r\n");
    return delimiter == std::string_view::npos ? std::string_view {} : request.substr(delimiter + 4);
  }

  /**
   * @brief Serializes stream settings for the local management page.
   *
   * @param settings Settings snapshot.
   * @return Compact JSON object.
   */
  std::string settings_json(const senaistream::StreamSettings &settings) {
    std::ostringstream json;
    json << "{\"display\":" << settings.display_index << ",\"width\":" << settings.width
         << ",\"height\":" << settings.height << ",\"fps\":" << settings.frames_per_second
         << ",\"bitrateMbps\":" << settings.bitrate_bps / 1'000'000
         << ",\"codec\":\"" << (settings.codec == senaistream::VideoCodec::hevc ? "hevc" : "h264")
         << "\",\"hardware\":" << (settings.prefer_hardware ? "true" : "false")
         << ",\"virtualDisplay\":" << (settings.prefer_virtual_display ? "true" : "false") << '}';
    return json.str();
  }

  /**
   * @brief Escapes one string for inclusion in a JSON string literal.
   *
   * @param value UTF-8 input text.
   * @return JSON-safe UTF-8 text without surrounding quotes.
   */
  std::string escape_json(std::string_view value) {
    std::string escaped;
    escaped.reserve(value.size());
    for (const auto character : value) {
      switch (character) {
        case '\\':
          escaped += "\\\\";
          break;
        case '"':
          escaped += "\\\"";
          break;
        case '\n':
          escaped += "\\n";
          break;
        case '\r':
          escaped += "\\r";
          break;
        case '\t':
          escaped += "\\t";
          break;
        default:
          escaped += character;
          break;
      }
    }
    return escaped;
  }

  /**
   * @brief Serializes currently active DXGI displays for the management page.
   *
   * @return JSON array or an object containing an enumeration error.
   */
  std::string displays_json() {
    std::string error;
    const auto displays = senaistream::DisplayCatalog().enumerate(error);
    if (!error.empty()) {
      return "{\"error\":\"" + escape_json(error) + "\",\"displays\":[]}";
    }
    std::ostringstream json;
    json << "{\"displays\":[";
    for (std::size_t index = 0; index < displays.size(); ++index) {
      if (index != 0) {
        json << ',';
      }
      const auto &display = displays[index];
      json << "{\"index\":" << display.index << ",\"name\":\"" << escape_json(display.name)
           << "\",\"deviceName\":\"" << escape_json(display.device_name) << "\",\"width\":" << display.width
           << ",\"height\":" << display.height
           << ",\"primary\":" << (display.primary ? "true" : "false")
           << ",\"virtual\":" << (display.virtual_display ? "true" : "false") << '}';
    }
    json << "]}";
    return json.str();
  }

  /**
   * @brief Requests a resolution and refresh rate for an extended display.
   *
   * @param display Target display returned by the DXGI catalog.
   * @param width Desired desktop width.
   * @param height Desired desktop height.
   * @param frames_per_second Desired integer refresh rate.
   * @return True when Windows applied the mode.
   */
  [[maybe_unused]] bool configure_display_mode(
    const senaistream::DisplayInfo &display,
    std::uint32_t width,
    std::uint32_t height,
    std::uint32_t frames_per_second
  ) {
    if (display.device_name.empty() || width == 0 || height == 0 || frames_per_second == 0) {
      return false;
    }
    const std::wstring device(display.device_name.begin(), display.device_name.end());
    DEVMODEW mode {};
    mode.dmSize = sizeof(mode);
    if (!EnumDisplaySettingsW(device.c_str(), ENUM_CURRENT_SETTINGS, &mode)) {
      return false;
    }
    mode.dmPelsWidth = width;
    mode.dmPelsHeight = height;
    mode.dmDisplayFrequency = frames_per_second;
    mode.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY;
    return ChangeDisplaySettingsExW(device.c_str(), &mode, nullptr, CDS_UPDATEREGISTRY, nullptr) == DISP_CHANGE_SUCCESSFUL;
  }

  /**
   * @brief Switches Windows between extended and duplicated display topology.
   *
   * @param extended True for an extended desktop or false for cloned displays.
   * @return True when Windows accepted the requested topology.
   */
  bool apply_display_topology(bool extended) {
    const auto topology = extended ? SDC_TOPOLOGY_EXTEND : SDC_TOPOLOGY_CLONE;
    for (int attempt = 0; attempt < 3; ++attempt) {
      const auto result = SetDisplayConfig(
        0,
        nullptr,
        0,
        nullptr,
        SDC_APPLY | topology | SDC_ALLOW_CHANGES | SDC_SAVE_TO_DATABASE
      );
      if (result == ERROR_SUCCESS) {
        std::this_thread::sleep_for(std::chrono::milliseconds(450));
        return true;
      }
      std::this_thread::sleep_for(std::chrono::milliseconds(180));
    }
    std::array<wchar_t, MAX_PATH> system_directory {};
    if (GetSystemDirectoryW(system_directory.data(), static_cast<UINT>(system_directory.size())) == 0) {
      return false;
    }
    const auto executable = std::filesystem::path(system_directory.data()) / L"DisplaySwitch.exe";
    std::wstring command_line = L"\"" + executable.wstring() + (extended ? L"\" /extend" : L"\" /clone");
    STARTUPINFOW startup {};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process {};
    if (!CreateProcessW(
          executable.c_str(),
          command_line.data(),
          nullptr,
          nullptr,
          FALSE,
          CREATE_NO_WINDOW,
          nullptr,
          nullptr,
          &startup,
          &process
        )) {
      return false;
    }
    WaitForSingleObject(process.hProcess, 10'000);
    DWORD exit_code = 1;
    GetExitCodeProcess(process.hProcess, &exit_code);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    std::this_thread::sleep_for(std::chrono::milliseconds(600));
    return exit_code == 0;
  }

  /**
   * @brief Detects whether active Windows targets use independent desktop sources.
   *
   * @return True when at least two active targets form an extended desktop.
   */
  bool is_extended_display_topology() {
    UINT32 path_count = 0;
    UINT32 mode_count = 0;
    if (GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &path_count, &mode_count) != ERROR_SUCCESS || path_count < 2) {
      return false;
    }
    std::vector<DISPLAYCONFIG_PATH_INFO> paths(path_count);
    std::vector<DISPLAYCONFIG_MODE_INFO> modes(mode_count);
    if (QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, &path_count, paths.data(), &mode_count, modes.data(), nullptr) != ERROR_SUCCESS) {
      return false;
    }
    paths.resize(path_count);
    for (std::size_t left = 0; left < paths.size(); ++left) {
      for (std::size_t right = left + 1; right < paths.size(); ++right) {
        const auto &first = paths[left].sourceInfo;
        const auto &second = paths[right].sourceInfo;
        if (first.id == second.id && first.adapterId.HighPart == second.adapterId.HighPart && first.adapterId.LowPart == second.adapterId.LowPart) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * @brief Parses settings submitted by the management form.
   *
   * @param body URL-encoded form body containing numeric ASCII fields.
   * @param settings Receives parsed settings.
   * @return True when all required fields were syntactically valid.
   */
  bool parse_settings_form(std::string_view body, senaistream::StreamSettings &settings) {
    const std::string synthetic_target = "/?" + std::string(body);
    std::uint32_t bitrate_mbps = 0;
    if (!parse_decimal(query_value(synthetic_target, "display"), settings.display_index) || !parse_decimal(query_value(synthetic_target, "width"), settings.width) || !parse_decimal(query_value(synthetic_target, "height"), settings.height) || !parse_decimal(query_value(synthetic_target, "fps"), settings.frames_per_second) || !parse_decimal(query_value(synthetic_target, "bitrateMbps"), bitrate_mbps)) {
      return false;
    }
    if (bitrate_mbps > 200) {
      return false;
    }
    settings.bitrate_bps = bitrate_mbps * 1'000'000;
    settings.codec = query_value(synthetic_target, "codec") == "hevc" ?
                       senaistream::VideoCodec::hevc :
                       senaistream::VideoCodec::h264;
    settings.prefer_hardware = query_value(synthetic_target, "hardware") == "1";
    settings.prefer_virtual_display = query_value(synthetic_target, "virtualDisplay") == "1";
    return true;
  }

  /**
   * @brief Returns the embedded local management application.
   *
   * @return Self-contained UTF-8 HTML document.
   */
  [[maybe_unused]] std::string_view legacy_management_html() {
    return R"HTML(<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SenaiStream</title><style>
:root{color-scheme:dark;font-family:Segoe UI,Arial,sans-serif;background:#07111f;color:#e8f1ff}*{box-sizing:border-box}
body{margin:0;background:radial-gradient(circle at 15% 0,#173963 0,#07111f 42%);min-height:100vh}.shell{max-width:940px;margin:auto;padding:36px 22px}
header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}.brand{font-size:28px;font-weight:750}.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#46e6a8;box-shadow:0 0 14px #46e6a8;margin-right:9px}
.card{background:#0e1d31dd;border:1px solid #263d59;border-radius:18px;padding:24px;box-shadow:0 18px 60px #0006}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.guide{margin-bottom:18px;display:flex;gap:16px;align-items:center}.guide b{display:block;margin-bottom:5px}.step{width:38px;height:38px;display:grid;place-items:center;border-radius:12px;background:#2d8cff;font-weight:800;flex:0 0 auto}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:18px}.stat{background:#0e1d31bb;border:1px solid #263d59;border-radius:14px;padding:16px}.stat small{display:block;color:#8fa5bd}.stat strong{font-size:20px}.pair{margin-bottom:18px;border-color:#2d8cff;display:none}.pair-row{display:flex;gap:12px;align-items:end}.pair-row>div{flex:1}.pair input{font-size:24px;letter-spacing:10px;text-align:center;max-width:240px}
label{display:block;color:#a9bbd1;font-size:13px;margin-bottom:7px}input,select{width:100%;background:#081525;color:#eef6ff;border:1px solid #34506f;border-radius:9px;padding:11px;font-size:15px}
.wide{grid-column:1/-1}.range{display:flex;gap:14px;align-items:center}.range input{padding:0}.pill{min-width:78px;text-align:center;background:#16304e;border-radius:20px;padding:7px}
.check{display:flex;gap:10px;align-items:center}.check input{width:auto}.actions{display:flex;align-items:center;gap:14px;margin-top:24px}button{border:0;border-radius:10px;background:#2d8cff;color:white;font-weight:700;padding:12px 22px;cursor:pointer}button:hover{background:#4aa0ff}
#message,#pinMessage{color:#9fb3ca}.ports{margin-top:18px;color:#8398af;font-size:13px}@media(max-width:650px){.grid,.stats{grid-template-columns:1fr}.wide{grid-column:auto}.pair-row{align-items:stretch;flex-direction:column}}
</style></head><body><main class="shell"><header><div class="brand">SenaiStream</div><div><span class="dot"></span>Host ativo</div></header>
<div class="stats"><div class="stat"><small>Transmissão</small><strong id="streamState">Aguardando</strong></div><div class="stat"><small>Dispositivos pareados</small><strong id="pairedCount">0</strong></div><div class="stat"><small>Endereço para o Moonlight</small><strong id="hostAddress">Carregando…</strong></div></div>
<section class="card guide"><div class="step">1</div><div><b>No Moonlight do celular, toque em + e adicione o endereço acima.</b><span>Depois selecione Desktop. Quando o celular mostrar quatro números, o campo de PIN aparecerá automaticamente aqui.</span></div></section>
<section class="card pair" id="pairCard"><h2>Parear novo dispositivo</h2><p>Digite os quatro números mostrados no Moonlight do celular.</p><div class="pair-row"><div><label for="pin">PIN do Moonlight</label><input id="pin" inputmode="numeric" maxlength="4" autocomplete="one-time-code" placeholder="••••"></div><button id="pinButton" type="button">Confirmar PIN</button><span id="pinMessage"></span></div></section>
<section class="card"><h2>Qualidade da transmissão</h2><p>As alterações entram na próxima conexão do Moonlight.</p><form id="form"><div class="grid">
<div><label for="display">Monitor para transmitir</label><select id="display" name="display"><option value="0">Detectando monitores…</option></select></div>
<div><label for="resolution">Resolução</label><select id="resolution"><option value="0x0">Solicitada pelo Moonlight</option><option value="1920x1080">1920 × 1080</option><option value="2560x1440">2560 × 1440</option><option value="3840x2160">3840 × 2160 (4K)</option><option value="custom">Personalizada</option></select></div>
<div><label for="width">Largura personalizada</label><input id="width" name="width" type="number" min="0" step="2"></div>
<div><label for="height">Altura personalizada</label><input id="height" name="height" type="number" min="0" step="2"></div>
<div><label for="fps">FPS (0 = Moonlight)</label><input id="fps" name="fps" type="number" min="0" max="240"></div>
<div><label for="codec">Codec ao vivo</label><select id="codec" name="codec"><option value="h264">H.264 — recomendado para este teste</option></select></div>
<div class="wide"><label for="bitrate">Taxa de bits</label><div class="range"><input id="bitrate" name="bitrateMbps" type="range" min="5" max="150" step="5"><span class="pill"><b id="bitrateValue"></b> Mbps</span></div></div>
<div class="wide check"><input id="hardware" name="hardware" type="checkbox" value="1"><label for="hardware">Preferir encoder da GPU (NVENC/AMF/Quick Sync via Media Foundation)</label></div>
<div class="wide check"><input id="virtualDisplay" name="virtualDisplay" type="checkbox" value="1"><label for="virtualDisplay">Transmitir automaticamente a tela virtual estendida quando ela estiver instalada</label></div>
</div><div class="actions"><button type="submit">Salvar configurações</button><span id="message"></span></div></form>
<div class="ports">Portas padrão preservadas: TCP 47984, 47989 e 48010 · UDP 47998, 47999, 48000 e 48010</div></section></main>
<script>
const f=document.querySelector('#form'),res=document.querySelector('#resolution'),w=document.querySelector('#width'),h=document.querySelector('#height'),br=document.querySelector('#bitrate'),msg=document.querySelector('#message');
const show=()=>document.querySelector('#bitrateValue').textContent=br.value;br.oninput=show;
res.onchange=()=>{if(res.value!=='custom'){const p=res.value.split('x');w.value=p[0];h.value=p[1]}};
Promise.all([fetch('/api/settings').then(r=>r.json()),fetch('/api/displays').then(r=>r.json())]).then(([s,c])=>{f.display.innerHTML='';for(const d of c.displays){const o=document.createElement('option');o.value=d.index;o.textContent=(d.virtual?'Tela virtual — ':(d.primary?'Principal — ':''))+d.name+' · '+d.width+' × '+d.height;f.display.appendChild(o)}if(!c.displays.length){const o=document.createElement('option');o.value='0';o.textContent=c.error||'Nenhum monitor ativo';f.display.appendChild(o)}f.display.value=s.display;w.value=s.width;h.value=s.height;f.fps.value=s.fps;br.value=s.bitrateMbps;f.codec.value='h264';f.hardware.checked=s.hardware;f.virtualDisplay.checked=s.virtualDisplay;const v=s.width+'x'+s.height;res.value=[...res.options].some(o=>o.value===v)?v:'custom';show()});
f.onsubmit=async e=>{e.preventDefault();const p=new URLSearchParams(new FormData(f));if(!f.hardware.checked)p.set('hardware','0');if(!f.virtualDisplay.checked)p.set('virtualDisplay','0');const r=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:p});msg.textContent=await r.text();msg.style.color=r.ok?'#46e6a8':'#ff8292'};
async function refresh(){try{const s=await fetch('/api/status').then(r=>r.json());document.querySelector('#streamState').textContent=s.active?'Transmitindo':'Aguardando';document.querySelector('#pairedCount').textContent=s.pairedClients;document.querySelector('#hostAddress').textContent=s.address;document.querySelector('#pairCard').style.display=s.pairingWaiting?'block':'none'}catch{}}setInterval(refresh,1000);refresh();
document.querySelector('#pinButton').onclick=async()=>{const pin=document.querySelector('#pin').value;const r=await fetch('/api/pin',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({pin})});const m=document.querySelector('#pinMessage');m.textContent=await r.text();m.style.color=r.ok?'#46e6a8':'#ff8292'};
</script></body></html>)HTML";
  }

  /**
   * @brief Returns the embedded native-dashboard document.
   *
   * @return Complete UTF-8 HTML document.
   */
  std::string_view management_html() {
    return senaistream::ui::management_page;
  }

  /**
   * @brief Builds a one-application GameStream app list.
   *
   * @return UTF-8 XML response body.
   */
  std::string app_list_xml() {
    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
           "<root status_code=\"200\" status_message=\"OK\">"
           "<App><AppTitle>Desktop</AppTitle><ID>1</ID><IsHdrSupported>0</IsHdrSupported>"
           "<DirectLaunch>0</DirectLaunch></App></root>";
  }

  /**
   * @brief Builds a successful generic GameStream response.
   *
   * @param extra_xml Optional elements placed inside the root.
   * @return UTF-8 XML response body.
   */
  std::string success_xml(std::string_view extra_xml = {}) {
    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?><root status_code=\"200\" status_message=\"OK\">" +
           std::string(extra_xml) + "</root>";
  }

  /**
   * @brief Extracts a case-insensitive HTTP or RTSP header value.
   *
   * @param request Complete RTSP request.
   * @param name Header name including no colon.
   * @return Header value without surrounding whitespace.
   */
  std::string rtsp_header(std::string_view request, std::string_view name) {
    auto position = request.find("\r\n");
    while (position != std::string_view::npos) {
      position += 2;
      const auto end = request.find("\r\n", position);
      if (end == std::string_view::npos || end == position) {
        break;
      }
      const auto line = request.substr(position, end - position);
      const auto colon = line.find(':');
      if (colon == name.size() && std::equal(name.begin(), name.end(), line.begin(), [](char a, char b) {
            return std::tolower(static_cast<unsigned char>(a)) == std::tolower(static_cast<unsigned char>(b));
          })) {
        const auto value_start = line.find_first_not_of(" \t", colon + 1);
        if (value_start == std::string_view::npos) {
          return {};
        }
        const auto last = line.find_last_not_of(" \t");
        return std::string(line.substr(value_start, last - value_start + 1));
      }
      position = end;
    }
    return {};
  }

  /**
   * @brief Receives one complete RTSP transaction including its optional body.
   *
   * @param socket Connected RTSP TCP socket.
   * @return Complete request, or no value for a disconnect or malformed size.
   */
  std::optional<std::string> receive_rtsp_request(SOCKET socket) {
    constexpr std::size_t maximum_request_size = 1024 * 1024;
    std::string request;
    std::array<char, 8192> chunk {};
    std::optional<std::size_t> expected_size;
    for (;;) {
      const auto received = recv(socket, chunk.data(), static_cast<int>(chunk.size()), 0);
      if (received <= 0) {
        return std::nullopt;
      }
      request.append(chunk.data(), static_cast<std::size_t>(received));
      if (request.size() > maximum_request_size) {
        return std::nullopt;
      }
      if (!expected_size) {
        const auto header_end = request.find("\r\n\r\n");
        if (header_end == std::string::npos) {
          continue;
        }
        const auto length_text = rtsp_header(request, "Content-length");
        try {
          const auto body_size = length_text.empty() ? 0ULL : std::stoull(length_text);
          if (body_size > maximum_request_size - header_end - 4) {
            return std::nullopt;
          }
          expected_size = header_end + 4 + static_cast<std::size_t>(body_size);
        } catch (const std::exception &) {
          return std::nullopt;
        }
      }
      if (request.size() >= *expected_size) {
        request.resize(*expected_size);
        return request;
      }
    }
  }

  /**
   * @brief Builds an RTSP success response for the observed request.
   *
   * @param request RTSP request containing a CSeq header.
   * @param extra_headers Additional complete header lines.
   * @param body Optional response body.
   * @return Complete RTSP response.
   */
  std::string rtsp_success(std::string_view request, std::string_view extra_headers = {}, std::string_view body = {}) {
    std::ostringstream response;
    response << "RTSP/1.0 200 OK\r\n"
             << "CSeq: " << rtsp_header(request, "CSeq") << "\r\n"
             << extra_headers;
    if (!body.empty()) {
      response << "Content-Type: application/sdp\r\nContent-Length: " << body.size() << "\r\n";
    }
    response << "\r\n"
             << body;
    return response.str();
  }

}  // namespace

namespace senaistream {

  bool is_connectivity_probe(std::string_view datagram) noexcept {
    constexpr std::string_view signature = "moonlight-ctest";
    return datagram.size() >= signature.size() && datagram.substr(0, signature.size()) == signature;
  }

  std::string build_rtsp_response(std::string_view request, std::uint16_t base_port) {
    const auto method_end = request.find(' ');
    const auto method = method_end == std::string_view::npos ? std::string_view {} : request.substr(0, method_end);
    if (method == "OPTIONS") {
      return rtsp_success(request, "Public: OPTIONS, DESCRIBE, SETUP, ANNOUNCE, PLAY, TEARDOWN\r\n");
    }
    if (method == "DESCRIBE") {
      const std::string session_description =
        "v=0\r\n"
        "o=SenaiStream 0 0 IN IP4 127.0.0.1\r\n"
        "s=SenaiStream Desktop\r\n"
        "t=0 0\r\n"
        "m=video 47998 RTP/AVP 96\r\n"
        "a=rtpmap:96 H264/90000\r\n"
        "m=audio 48000 RTP/AVP 97\r\n"
        "a=rtpmap:97 opus/48000/2\r\n";
      auto description = session_description;
      for (const auto port : {47998, 48000}) {
        const auto pos = description.find(std::to_string(port));
        if (pos != std::string::npos) {
          description.replace(pos, 5, std::to_string(base_port + port - 47989));
        }
      }
      return rtsp_success(request, {}, description);
    }
    if (method == "SETUP") {
      std::string_view transport = "Transport: unicast;server_port=47999-48000\r\n";
      if (request.find("streamid=audio") != std::string_view::npos) {
        transport = "Transport: unicast;server_port=48000-48001\r\n";
      } else if (request.find("streamid=video") != std::string_view::npos) {
        transport = "Transport: unicast;server_port=47998-47999\r\n";
      }
      const auto port = request.find("streamid=audio") != std::string_view::npos ? base_port + 11 :
                        request.find("streamid=video") != std::string_view::npos ? base_port + 9 :
                                                                                   base_port + 10;
      return rtsp_success(request, "Transport: unicast;server_port=" + std::to_string(port) + "-" + std::to_string(port + 1) + "\r\nSession: 1\r\n");
    }
    return rtsp_success(request, "Session: 1\r\n");
  }

  std::string build_server_info_xml(const HostIdentity &identity, bool paired, bool busy) {
    std::ostringstream xml;
    xml << "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
        << "<root protocol_version=\"0.1\" query=\"serverinfo\" status_code=\"200\" status_message=\"OK\">"
        << "<hostname>" << escape_xml(identity.hostname) << "</hostname>"
        << "<appversion>7.1.431.-1</appversion>"
        << "<GfeVersion>3.23.0.74</GfeVersion>"
        << "<uniqueid>" << escape_xml(identity.unique_id) << "</uniqueid>"
        << "<HttpsPort>" << identity.https_port << "</HttpsPort>"
        << "<ExternalPort>" << identity.http_port << "</ExternalPort>"
        << "<MaxLumaPixelsH264>1721324928</MaxLumaPixelsH264>"
        << "<MaxLumaPixelsHEVC>0</MaxLumaPixelsHEVC>"
        << "<ServerCodecModeSupport>1</ServerCodecModeSupport>"
        << "<mac>00:00:00:00:00:00</mac>"
        << "<LocalIP>" << escape_xml(identity.local_address) << "</LocalIP>"
        << "<PairStatus>" << (paired ? 1 : 0) << "</PairStatus>"
        << "<currentgame>" << (busy ? 1 : 0) << "</currentgame>"
        << "<state>" << (busy ? "MJOLNIR_STATE_SERVER_BUSY" : "MJOLNIR_STATE_SERVER_AVAILABLE") << "</state>"
        << "</root>";
    return xml.str();
  }

  GameStreamHost::GameStreamHost(HostIdentity identity):
      identity_(std::move(identity)) {
  }

  Status GameStreamHost::run() {
    const auto pairing_status = pairing_.initialize();
    if (!pairing_status.ok()) {
      return pairing_status;
    }
    const auto settings_status = settings_.initialize();
    if (!settings_status.ok()) {
      return settings_status;
    }
    WinsockRuntime winsock;
    if (winsock.result() != 0) {
      return Status::failure("WSAStartup failed with " + std::to_string(winsock.result()));
    }
    EnetRuntime enet;
    if (enet.result() != 0) {
      return Status::failure("ENet initialization failed");
    }
    SocketHandle http_listener(create_listener(identity_.http_port));
    if (http_listener.get() == INVALID_SOCKET) {
      return Status::failure("Unable to bind TCP port " + std::to_string(identity_.http_port) + ": " + std::to_string(WSAGetLastError()));
    }
    SocketHandle https_listener(create_listener(identity_.https_port));
    if (https_listener.get() == INVALID_SOCKET) {
      return Status::failure("Unable to bind TCP port " + std::to_string(identity_.https_port) + ": " + std::to_string(WSAGetLastError()));
    }
    auto tls_context = create_tls_context(pairing_.host_certificate_pem(), pairing_.host_private_key_pem());
    if (!tls_context) {
      return Status::failure("Unable to initialize the GameStream TLS context");
    }
    SocketHandle rtsp_listener(create_listener(identity_.http_port + 21));
    if (rtsp_listener.get() == INVALID_SOCKET) {
      return Status::failure("Unable to bind RTSP TCP port 48010: " + std::to_string(WSAGetLastError()));
    }
    SocketHandle management_listener(create_loopback_listener(identity_.http_port + 1));
    if (management_listener.get() == INVALID_SOCKET) {
      return Status::failure("Unable to bind local management TCP port 47990: " + std::to_string(WSAGetLastError()));
    }
    sockaddr_in control_socket_address {};
    control_socket_address.sin_family = AF_INET;
    control_socket_address.sin_addr.s_addr = htonl(INADDR_ANY);
    control_socket_address.sin_port = htons(identity_.http_port + 10);
    ENetAddress control_address {};
    if (enet_address_set_address(&control_address, reinterpret_cast<sockaddr *>(&control_socket_address), sizeof(control_socket_address)) != 0 || enet_address_set_port(&control_address, identity_.http_port + 10) != 0) {
      return Status::failure("Unable to configure ENet control address");
    }
    std::unique_ptr<ENetHost, EnetHostDeleter> control_host(enet_host_create(AF_INET, &control_address, max_stream_clients, 48, 0, 0));
    if (!control_host) {
      return Status::failure("Unable to bind ENet control port 47999");
    }

    const std::array<std::uint16_t, 3> udp_ports {static_cast<std::uint16_t>(identity_.http_port + 9), static_cast<std::uint16_t>(identity_.http_port + 11), static_cast<std::uint16_t>(identity_.http_port + 21)};
    std::array<SocketHandle, udp_ports.size()> udp_listeners;
    for (std::size_t index = 0; index < udp_ports.size(); ++index) {
      udp_listeners[index] = SocketHandle(create_udp_listener(udp_ports[index]));
      if (udp_listeners[index].get() == INVALID_SOCKET) {
        return Status::failure("Unable to bind UDP port " + std::to_string(udp_ports[index]) + ": " + std::to_string(WSAGetLastError()));
      }
    }

    std::cout << "GameStream listening on HTTP " << identity_.http_port << ", HTTPS " << identity_.https_port
              << ", RTSP 48010, and UDP media/control ports\n"
              << "Management panel: http://127.0.0.1:47990/\n";
    std::vector<std::future<void>> workers;
    SessionRegistry<RuntimeSession> sessions;
    const auto restart_capture = [&]() {
      for (const auto &[address, session] : sessions.snapshot()) {
        session->restart_video.store(true);
      }
    };
    const auto active_clients = [&]() {
      std::size_t count = 0;
      for (const auto &[address, session] : sessions.snapshot()) {
        if (session->active.load() && !session->stop.load()) {
          ++count;
        }
      }
      return count;
    };
    std::mutex pin_mutex;
    std::condition_variable pin_ready;
    std::string submitted_pin;
    bool pairing_waiting = false;

    while (!stop_requested_.load()) {
      std::erase_if(workers, [](auto &worker) {
        return worker.wait_for(std::chrono::seconds(0)) == std::future_status::ready;
      });
      for (const auto &[address, session] : sessions.snapshot()) {
        if (session->stop.load() || (!session->active.load() && std::chrono::steady_clock::now() - session->created > std::chrono::seconds(30))) {
          session->stop.store(true);
          if (session->control_peer) {
            enet_peer_disconnect_now(session->control_peer, 0);
          }
          session->control_peer = nullptr;
          if (session->video.joinable()) {
            session->video.join();
          }
          if (session->audio.joinable()) {
            session->audio.join();
          }
          sessions.erase(address, session);
        }
      }
      fd_set sockets;
      FD_ZERO(&sockets);
      FD_SET(http_listener.get(), &sockets);
      FD_SET(https_listener.get(), &sockets);
      FD_SET(rtsp_listener.get(), &sockets);
      FD_SET(management_listener.get(), &sockets);
      for (const auto &listener : udp_listeners) {
        FD_SET(listener.get(), &sockets);
      }
      timeval timeout {0, 5'000};
      const auto ready = select(0, &sockets, nullptr, nullptr, &timeout);
      if (ready == SOCKET_ERROR) {
        stop_requested_.store(true);
        break;
      }
      ENetEvent control_event {};
      while (enet_host_service(control_host.get(), &control_event, 0) > 0) {
        const auto address = peer_address(control_event.peer->address.address);
        const auto session = sessions.find(address);
        if (!session || session->stop.load() || (session->control_peer && session->control_peer != control_event.peer)) {
          if (control_event.type == ENET_EVENT_TYPE_RECEIVE) {
            enet_packet_destroy(control_event.packet);
          }
          enet_peer_disconnect_now(control_event.peer, 0);
          continue;
        }
        auto &session_config = session->config;
        auto &session_mutex = session->mutex;
        auto &input_mutex = session->input_mutex;
        auto &input_viewport = session->viewport;
        if (control_event.type == ENET_EVENT_TYPE_CONNECT) {
          session->control_peer = control_event.peer;
          session->active.store(true);
          std::cout << "ENet control client connected on UDP 47999\n";
        } else if (control_event.type == ENET_EVENT_TYPE_RECEIVE) {
          RuntimeSessionConfig session_snapshot;
          {
            std::scoped_lock lock(session_mutex);
            session_snapshot = session_config;
          }
          bool injected = false;
          if (session_snapshot.ready) {
            InputViewport viewport_snapshot;
            {
              std::scoped_lock lock(input_mutex);
              viewport_snapshot = input_viewport;
            }
            const auto plaintext = decrypt_control_packet(
              std::span<const std::uint8_t>(control_event.packet->data, control_event.packet->dataLength),
              session_snapshot.key
            );
            if (plaintext && plaintext->size() >= 4 && load_le16(plaintext->data()) == 0x0302) {
              session->restart_video.store(true);  // A fresh encoder emits an IDR with parameter sets.
              injected = true;
            }
            if (plaintext && plaintext->size() >= 4 && load_le16(plaintext->data()) == 0x0206) {
              const auto payload_size = load_le16(plaintext->data() + 2);
              if (static_cast<std::size_t>(payload_size) + 4 <= plaintext->size()) {
                injected = inject_win32_input(
                  std::span<const std::uint8_t>(plaintext->data() + 4, payload_size),
                  viewport_snapshot
                );
              }
            }
          }
          if (!injected && control_event.channelID != 0) {
            std::cout << "Encrypted control packet received: channel=" << static_cast<unsigned>(control_event.channelID)
                      << " bytes=" << control_event.packet->dataLength << '\n';
          }
          enet_packet_destroy(control_event.packet);
        } else if (control_event.type == ENET_EVENT_TYPE_DISCONNECT) {
          session->active.store(false);
          session->control_peer = nullptr;
          session->stop.store(true);
          std::cout << "ENet client disconnected: " << address << '\n';
        }
      }
      if (ready == 0) {
        continue;
      }
      for (std::size_t index = 0; index < udp_listeners.size(); ++index) {
        if (FD_ISSET(udp_listeners[index].get(), &sockets) == 0) {
          continue;
        }
        std::array<char, 2048> datagram {};
        sockaddr_storage peer {};
        int peer_size = sizeof(peer);
        const auto received = recvfrom(udp_listeners[index].get(), datagram.data(), static_cast<int>(datagram.size()), 0, reinterpret_cast<sockaddr *>(&peer), &peer_size);
        const auto session = sessions.find(peer_address(peer));
        if (received > 0 && is_connectivity_probe(std::string_view(datagram.data(), static_cast<std::size_t>(received)))) {
          sendto(udp_listeners[index].get(), datagram.data(), received, 0, reinterpret_cast<const sockaddr *>(&peer), peer_size);
          std::cout << "UDP connectivity probe answered on port " << udp_ports[index] << '\n';
        } else if (!session || session->stop.load()) {
          continue;
        } else {
          auto &media_stop_requested = session->stop;
          auto &video_restart_requested = session->restart_video;
          auto &video_stream_thread = session->video;
          auto &audio_stream_thread = session->audio;
          auto &session_config = session->config;
          auto &session_mutex = session->mutex;
          auto &input_mutex = session->input_mutex;
          auto &input_viewport = session->viewport;
          if (index == 0 && received >= 4 && std::memcmp(datagram.data(), "PING", 4) == 0 && !video_stream_thread.joinable()) {
            media_stop_requested.store(false);
            const auto video_peer = peer;
            const auto video_peer_size = peer_size;
            const auto video_socket = udp_listeners[index].get();
            RuntimeSessionConfig negotiated;
            {
              std::scoped_lock lock(session_mutex);
              negotiated = session_config;
            }
            video_stream_thread = std::thread(
              [this,
               session,
               video_socket,
               video_peer,
               video_peer_size,
               negotiated,
               &input_mutex,
               &input_viewport,
               &media_stop_requested,
               &video_restart_requested]() mutable {
                SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST);
                VideoPacketizerState packetizer_state;
                const auto stream_clock_start = std::chrono::steady_clock::now();
                while (!media_stop_requested.load()) {
                  video_restart_requested.store(false);
                  const auto user_settings = settings_.current();
                  VideoRecordConfig config;
                  config.display_index = session->selected_display.load() >= 0 ? static_cast<std::uint32_t>(session->selected_display.load()) : user_settings.display_index;
                  config.width = user_settings.width == 0 ? negotiated.width : user_settings.width;
                  config.height = user_settings.height == 0 ? negotiated.height : user_settings.height;
                  config.frames_per_second =
                    user_settings.frames_per_second == 0 ? negotiated.frames_per_second : user_settings.frames_per_second;
                  config.bitrate_bps = user_settings.bitrate_bps;
                  config.codec = VideoCodec::h264;
                  config.prefer_hardware = user_settings.prefer_hardware;
                  config.duration_seconds = 86'400;

                  std::string display_error;
                  auto displays = DisplayCatalog().enumerate(display_error);
                  auto selected = std::find_if(displays.begin(), displays.end(), [&](const DisplayInfo &display) {
                    return display.index == config.display_index;
                  });
                  if (selected == displays.end() && user_settings.prefer_virtual_display) {
                    selected = std::find_if(displays.begin(), displays.end(), [](const DisplayInfo &d) {
                      return d.virtual_display;
                    });
                  }
                  if (selected == displays.end()) {
                    selected = std::find_if(displays.begin(), displays.end(), [](const DisplayInfo &display) {
                      return display.primary;
                    });
                    if (selected != displays.end()) {
                      config.display_index = selected->index;
                    }
                  }
                  if (selected != displays.end()) {
                    config.display_index = selected->index;
                  }
                  session->display.store(config.display_index);
                  session->width.store(config.width);
                  session->height.store(config.height);
                  {
                    std::scoped_lock lock(input_mutex);
                    input_viewport = selected == displays.end() ?
                                       InputViewport {} :
                                       InputViewport {
                                         selected->desktop_left,
                                         selected->desktop_top,
                                         selected->width,
                                         selected->height,
                                         true,
                                       };
                  }

                  bool announced_first_frame = false;
                  const auto send_frame = [&](std::span<const std::uint8_t> frame, bool key_frame, std::uint64_t encoder_timestamp_100ns) {
                    static_cast<void>(encoder_timestamp_100ns);
                    const auto elapsed = std::chrono::duration_cast<std::chrono::microseconds>(
                      std::chrono::steady_clock::now() - stream_clock_start
                    );
                    const auto timestamp_90khz = static_cast<std::uint32_t>((elapsed.count() * 9) / 100);
                    const auto packets = packetize_h264_frame(frame, key_frame, timestamp_90khz, 1392, packetizer_state);
                    for (const auto &packet : packets) {
                      if (sendto(video_socket, reinterpret_cast<const char *>(packet.data()), static_cast<int>(packet.size()), 0, reinterpret_cast<const sockaddr *>(&video_peer), video_peer_size) == SOCKET_ERROR) {
                        return false;
                      }
                    }
                    ++session->frames;
                    session->bytes.fetch_add(frame.size());
                    if (!announced_first_frame && !packets.empty()) {
                      std::cout << "Live H.264 output active on display " << config.display_index << '\n';
                      announced_first_frame = true;
                    }
                    return !media_stop_requested.load() && !video_restart_requested.load();
                  };
                  auto status = VideoRecorder().stream_h264(config, media_stop_requested, send_frame, &video_restart_requested);
                  if (!status.ok() && !media_stop_requested.load() && !video_restart_requested.load() && config.prefer_hardware) {
                    std::cerr << "Hardware H.264 encoder failed; retrying with the Windows software encoder: "
                              << status.message() << '\n';
                    config.prefer_hardware = false;
                    status = VideoRecorder().stream_h264(config, media_stop_requested, send_frame, &video_restart_requested);
                  }
                  if (video_restart_requested.exchange(false) && !media_stop_requested.load()) {
                    std::this_thread::sleep_for(std::chrono::milliseconds(180));
                    continue;
                  }
                  if (!status.ok() && !media_stop_requested.load()) {
                    std::cerr << "Capture recovering: " << status.message() << '\n';
                    for (int retry = 0; retry < 10 && !media_stop_requested.load(); ++retry) {
                      std::this_thread::sleep_for(std::chrono::milliseconds(50));
                    }
                    continue;
                  }
                  break;
                }
              }
            );
          } else if (index == 1 && received >= 4 && std::memcmp(datagram.data(), "PING", 4) == 0 && !audio_stream_thread.joinable()) {
            media_stop_requested.store(false);
            const auto audio_peer = peer;
            const auto audio_peer_size = peer_size;
            const auto audio_socket = udp_listeners[index].get();
            RuntimeSessionConfig negotiated;
            {
              std::scoped_lock lock(session_mutex);
              negotiated = session_config;
            }
            audio_stream_thread = std::thread(
              [session, audio_socket, audio_peer, audio_peer_size, negotiated, &media_stop_requested]() {
                AudioRecordConfig config;
                config.duration_seconds = 86'400;
                config.bitrate_bps = 192'000;
                config.frame_duration_ms = negotiated.audio_frame_ms;
                AudioPacketizerState packetizer_state;
                bool announced_first_packet = false;
                const auto status = AudioRecorder().stream_opus(
                  config,
                  media_stop_requested,
                  [&](std::span<const std::uint8_t> opus, std::uint32_t timestamp_48khz) {
                    std::optional<std::vector<std::uint8_t>> encrypted;
                    if (negotiated.encrypt_audio) {
                      encrypted = encrypt_audio_frame(
                        opus,
                        negotiated.key,
                        negotiated.key_id,
                        packetizer_state.sequence
                      );
                      if (!encrypted) {
                        return false;
                      }
                      opus = *encrypted;
                    }
                    const auto packet = packetize_opus_frame(opus, timestamp_48khz, packetizer_state);
                    if (sendto(audio_socket, reinterpret_cast<const char *>(packet.data()), static_cast<int>(packet.size()), 0, reinterpret_cast<const sockaddr *>(&audio_peer), audio_peer_size) == SOCKET_ERROR) {
                      return false;
                    }
                    if (!announced_first_packet) {
                      std::cout << "First live Opus packet sent\n";
                      announced_first_packet = true;
                    }
                    return !media_stop_requested.load();
                  }
                );
                if (!status.ok() && !media_stop_requested.load()) {
                  std::cerr << "Live audio stream failed: " << status.message() << '\n';
                }
              }
            );
          }
        }
      }
      const bool rtsp = FD_ISSET(rtsp_listener.get(), &sockets) != 0;
      const bool secure = !rtsp && FD_ISSET(https_listener.get(), &sockets) != 0;
      const bool plain = !rtsp && !secure && FD_ISSET(http_listener.get(), &sockets) != 0;
      const bool management = !rtsp && !secure && !plain && FD_ISSET(management_listener.get(), &sockets) != 0;
      if (!rtsp && !secure && !plain && !management) {
        continue;
      }
      const auto selected_listener = rtsp ? rtsp_listener.get() :
                                            (secure ? https_listener.get() :
                                                      (plain ? http_listener.get() : management_listener.get()));
      sockaddr_storage accepted_address {};
      int accepted_address_size = sizeof(accepted_address);
      const auto accepted_socket = accept(selected_listener, reinterpret_cast<sockaddr *>(&accepted_address), &accepted_address_size);
      if (accepted_socket == INVALID_SOCKET) {
        continue;
      }
      if (workers.size() >= 64) {
        closesocket(accepted_socket);
        continue;
      }
      workers.emplace_back(std::async(std::launch::async, [this, accepted_socket, secure, rtsp, management, context = tls_context.get(), remote_address = peer_address(accepted_address), &sessions, &active_clients, &restart_capture, &pin_mutex, &pin_ready, &submitted_pin, &pairing_waiting]() {
        SocketHandle client(accepted_socket);
        const DWORD socket_timeout = 5000;
        setsockopt(client.get(), SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char *>(&socket_timeout), sizeof(socket_timeout));
        setsockopt(client.get(), SOL_SOCKET, SO_SNDTIMEO, reinterpret_cast<const char *>(&socket_timeout), sizeof(socket_timeout));
        if (rtsp) {
          const auto session = sessions.find(remote_address);
          if (!session || session->stop.load()) {
            return;
          }
          auto &session_mutex = session->mutex;
          auto &session_config = session->config;
          const auto received_request = receive_rtsp_request(client.get());
          if (!received_request) {
            return;
          }
          const std::string_view request(*received_request);
          const auto method_end = request.find(' ');
          const auto method = method_end == std::string_view::npos ? std::string_view {} : request.substr(0, method_end);
          std::cout << "RTSP request: " << method << " CSeq=" << rtsp_header(request, "CSeq")
                    << " bytes=" << request.size() << '\n';
          if (method == "ANNOUNCE") {
            RuntimeSessionConfig updated;
            {
              std::scoped_lock lock(session_mutex);
              updated = session_config;
            }
            std::uint32_t feature_flags = 0;
            if (parse_decimal(sdp_attribute(request, "x-nv-general.featureFlags"), feature_flags)) {
              updated.encrypt_audio = (feature_flags & 0x20U) != 0;
              std::cout << "Moonlight audio encryption: " << (updated.encrypt_audio ? "enabled" : "disabled") << '\n';
            }
            std::uint32_t audio_frame_ms = 0;
            if (parse_decimal(sdp_attribute(request, "x-nv-aqos.packetDuration"), audio_frame_ms) && (audio_frame_ms == 5 || audio_frame_ms == 10 || audio_frame_ms == 20)) {
              updated.audio_frame_ms = audio_frame_ms;
            }
            std::uint32_t bitrate_kbps = 0;
            if (parse_decimal(sdp_attribute(request, "x-ml-video.configuredBitrateKbps"), bitrate_kbps) && bitrate_kbps >= 1'000 && bitrate_kbps <= 200'000) {
              updated.bitrate_bps = bitrate_kbps * 1'000;
            }
            {
              std::scoped_lock lock(session_mutex);
              session_config = updated;
            }
          }
          if (method == "TEARDOWN") {
            session->stop.store(true);
          }
          const auto response = build_rtsp_response(request, identity_.http_port);
          if (!send_all(client.get(), response)) {
            return;
          }
          // Moonlight's TCP RTSP transport delimits each response by closing the
          // connection, then opens a fresh connection for the next transaction.
          return;
        }
        if (management) {
          const auto complete_request = receive_rtsp_request(client.get());
          if (!complete_request) {
            return;
          }
          const std::string_view request(*complete_request);
          const auto target = request_target(request);
          const bool post = request.starts_with("POST ");
          std::string response;
          if (target == "/" && !post) {
            response = http_response("200 OK", "text/html; charset=utf-8", management_html());
          } else if (target == "/api/settings" && !post) {
            response = http_response("200 OK", "application/json; charset=utf-8", settings_json(settings_.current()));
          } else if (target == "/api/displays" && !post) {
            response = http_response("200 OK", "application/json; charset=utf-8", displays_json());
          } else if (target == "/api/status" && !post) {
            bool waiting = false;
            {
              std::scoped_lock lock(pin_mutex);
              waiting = pairing_waiting;
            }
            std::uint64_t frames = 0, bytes = 0, uptime = 0;
            std::uint32_t width = 0, height = 0;
            for (const auto &[address, session] : sessions.snapshot()) {
              frames += session->frames.load();
              bytes += session->bytes.load();
              width = session->width.load();
              height = session->height.load();
              uptime = std::max(uptime, static_cast<std::uint64_t>(std::chrono::duration_cast<std::chrono::seconds>(std::chrono::steady_clock::now() - session->created).count()));
            }
            const bool extended_topology = is_extended_display_topology();
            std::ostringstream status_body;
            status_body << "{\"active\":" << (active_clients() > 0 ? "true" : "false")
                        << ",\"hostType\":\"SpaceViewer\",\"apiVersion\":2,\"activeClients\":" << active_clients()
                        << ",\"maxClients\":" << max_stream_clients
                        << ",\"frames\":" << frames << ",\"bytes\":" << bytes << ",\"uptime\":" << uptime
                        << ",\"width\":" << width << ",\"height\":" << height
                        << ",\"pairingWaiting\":" << (waiting ? "true" : "false")
                        << ",\"pairedClients\":" << pairing_.authorized_client_count()
                        << ",\"displayMode\":\""
                        << (extended_topology ? "extended" : "duplicate") << "\""
                        << ",\"address\":\"" << identity_.local_address << "\"}";
            response = http_response("200 OK", "application/json; charset=utf-8", status_body.str());
          } else if (target == "/api/sessions" && !post) {
            std::ostringstream list;
            list << "{\"sessions\":[";
            bool first = true;
            for (const auto &[address, session] : sessions.snapshot()) {
              if (!session->active.load() || session->stop.load()) {
                continue;
              }
              if (!first) {
                list << ',';
              }
              first = false;
              const auto display = session->selected_display.load();
              list << "{\"address\":\"" << address << "\",\"display\":"
                   << (display >= 0 ? display : static_cast<int>(settings_.current().display_index)) << "}";
            }
            list << "]}";
            response = http_response("200 OK", "application/json", list.str());
          } else if (target == "/api/session-display" && post) {
            const auto form = "/?" + std::string(http_body(request));
            const auto session = sessions.find(std::string(query_value(form, "address")));
            std::uint32_t display = 0;
            std::string error;
            const auto displays = DisplayCatalog().enumerate(error);
            if (!session || session->stop.load() || !parse_decimal(query_value(form, "display"), display) || std::none_of(displays.begin(), displays.end(), [&](const auto &d) {
                  return d.index == display;
                })) {
              response = http_response("400 Bad Request", "text/plain", "Cliente ou monitor indisponivel.");
            } else {
              session->selected_display.store(static_cast<int>(display));
              session->restart_video.store(true);
              response = http_response("200 OK", "text/plain", "Tela da TV atualizada.");
            }
          } else if (target == "/api/clients" && !post) {
            std::ostringstream clients;
            clients << "{\"clients\":[";
            bool first = true;
            for (const auto &id : pairing_.authorized_clients()) {
              if (!first) {
                clients << ',';
              }
              first = false;
              clients << "{\"uuid\":\"" << id << "\",\"name\":\"Moonlight " << id.substr(0, 8) << "\",\"enabled\":true}";
            }
            clients << "]}";
            response = http_response("200 OK", "application/json", clients.str());
          } else if (target == "/api/clients/remove" && post) {
            const auto form = "/?" + std::string(http_body(request));
            const auto id = query_value(form, "uuid");
            const auto result = pairing_.remove_client(id);
            if (result.ok()) {
              for (const auto &[address, session] : sessions.snapshot()) {
                if (!pairing_.is_authorized_client(session->client_certificate)) {
                  session->stop.store(true);
                }
              }
            }
            response = http_response(result.ok() ? "200 OK" : "400 Bad Request", "text/plain", result.ok() ? "Cliente removido." : result.message());
          } else if (target == "/api/refresh-capture" && post) {
            restart_capture();
            response = http_response("200 OK", "text/plain", "Captura atualizada.");
          } else if (target == "/api/pin" && post) {
            const auto form = "/?" + std::string(http_body(request));
            const auto pin = query_value(form, "pin");
            const bool valid = pin.size() == 4 &&
                               std::all_of(pin.begin(), pin.end(), [](char value) {
                                 return value >= '0' && value <= '9';
                               });
            bool accepted = false;
            {
              std::scoped_lock lock(pin_mutex);
              if (valid && pairing_waiting) {
                submitted_pin.assign(pin);
                accepted = true;
              }
            }
            if (accepted) {
              pin_ready.notify_all();
              response = http_response("200 OK", "text/plain; charset=utf-8", "PIN enviado ao pareamento.");
            } else if (!valid) {
              response = http_response("400 Bad Request", "text/plain; charset=utf-8", "Informe os 4 dígitos exibidos no Moonlight.");
            } else {
              response = http_response("409 Conflict", "text/plain; charset=utf-8", "Inicie o pareamento no Moonlight antes de enviar o PIN.");
            }
          } else if (target == "/api/settings" && post) {
            StreamSettings updated;
            if (!parse_settings_form(http_body(request), updated)) {
              response = http_response("400 Bad Request", "text/plain; charset=utf-8", "Campos inválidos.");
            } else {
              const auto status = settings_.update(updated);
              if (status.ok()) {
                restart_capture();
              }
              response = status.ok() ?
                           http_response("200 OK", "text/plain; charset=utf-8", "Configurações salvas.") :
                           http_response("400 Bad Request", "text/plain; charset=utf-8", status.message());
            }
          } else if (target == "/api/display-mode" && post) {
            const auto form = "/?" + std::string(http_body(request));
            const auto mode = query_value(form, "mode");
            if (mode != "extend" && mode != "duplicate") {
              response = http_response("400 Bad Request", "text/plain; charset=utf-8", "Modo de tela inválido.");
            } else if (!apply_display_topology(mode == "extend")) {
              response = http_response(
                "500 Internal Server Error",
                "text/plain; charset=utf-8",
                "O Windows recusou a troca de tela."
              );
            } else {
              auto updated = settings_.current();
              updated.prefer_virtual_display = mode == "extend";
              std::string display_error;
              const auto displays = DisplayCatalog().enumerate(display_error);
              const auto preferred = std::find_if(displays.begin(), displays.end(), [&](const DisplayInfo &display) {
                return mode == "extend" ? display.virtual_display : display.primary;
              });
              if (preferred != displays.end()) {
                updated.display_index = preferred->index;
              }
              const auto update_status = settings_.update(updated);
              if (!update_status.ok()) {
                response = http_response("500 Internal Server Error", "text/plain; charset=utf-8", update_status.message());
              } else {
                restart_capture();
                response = http_response(
                  "200 OK",
                  "text/plain; charset=utf-8",
                  mode == "extend" ? "Tela estendida ativada." : "Telas duplicadas."
                );
              }
            }
          } else {
            response = http_response("404 Not Found", "text/plain; charset=utf-8", "Não encontrado.");
          }
          send_all(client.get(), response);
          return;
        }
        std::unique_ptr<SSL, SslDeleter> tls;
        bool client_is_authorized = false;
        std::string peer_pem;
        if (secure) {
          tls.reset(SSL_new(context));
          if (!tls || SSL_set_fd(tls.get(), static_cast<int>(client.get())) != 1 || SSL_accept(tls.get()) != 1) {
            return;
          }
          X509 *peer = SSL_get1_peer_certificate(tls.get());
          peer_pem = peer_certificate_pem(peer);
          client_is_authorized = pairing_.is_authorized_client(peer_pem);
          X509_free(peer);
        }
        std::array<char, 65'536> request_buffer {};
        const auto received = secure ? SSL_read(tls.get(), request_buffer.data(), static_cast<int>(request_buffer.size() - 1)) :
                                       recv(client.get(), request_buffer.data(), static_cast<int>(request_buffer.size() - 1), 0);
        if (received <= 0) {
          return;
        }
        const std::string_view request(request_buffer.data(), static_cast<std::size_t>(received));
        const auto target = request_target(request);
        const auto query = target.find('?');
        std::cout << (secure ? "HTTPS" : "HTTP") << " GameStream request: "
                  << target.substr(0, query) << '\n';
        std::string body;
        std::string status = "200 OK";
        if (target.starts_with("/serverinfo")) {
          body = build_server_info_xml(identity_, secure && client_is_authorized, false);
        } else if (target.starts_with("/pair")) {
          body = pairing_.handle_request(target, [&]() {
            std::unique_lock lock(pin_mutex);
            submitted_pin.clear();
            pairing_waiting = true;
            std::cout << "Pairing PIN requested; enter it in the management panel\n";
            pin_ready.wait_for(lock, std::chrono::minutes(3), [&]() {
              return stop_requested_.load() || !submitted_pin.empty();
            });
            pairing_waiting = false;
            return std::exchange(submitted_pin, {});
          });
        } else if (secure && client_is_authorized && target.starts_with("/applist")) {
          body = app_list_xml();
        } else if (secure && client_is_authorized && (target.starts_with("/launch") || target.starts_with("/resume"))) {
          RuntimeSessionConfig updated;
          if (!parse_launch_config(target, updated)) {
            std::cerr << "Rejected launch parameters: key_chars=" << query_value(target, "rikey").size()
                      << " key_id_chars=" << query_value(target, "rikeyid").size() << '\n';
            status = "400 Bad Request";
            body = "<?xml version=\"1.0\"?><root status_code=\"400\" status_message=\"Invalid session key\"/>";
          } else {
            std::cout << "Accepted streaming mode " << updated.width << 'x' << updated.height << 'x'
                      << updated.frames_per_second << '\n';
            auto session = std::make_shared<RuntimeSession>();
            session->config = updated;
            session->client_certificate = peer_pem;
            if (!sessions.insert(remote_address, session)) {
              status = "409 Conflict";
              body = "<?xml version=\"1.0\"?><root status_code=\"409\" status_message=\"Client already connected or four-client limit reached\"/>";
            } else {
              body = success_xml("<gamesession>1</gamesession><sessionUrl0>rtsp://" + identity_.local_address + ":" + std::to_string(identity_.http_port + 21) + "</sessionUrl0>");
            }
          }
        } else if (secure && client_is_authorized && target.starts_with("/cancel")) {
          const auto session = sessions.find(remote_address);
          if (session && session->client_certificate == peer_pem) {
            session->stop.store(true);
          }
          body = success_xml("<gamesession>1</gamesession>");
        } else {
          status = "404 Not Found";
          body = "<?xml version=\"1.0\"?><root status_code=\"404\" status_message=\"Not Found\"/>";
        }
        const auto response = http_response(status, "application/xml; charset=utf-8", body);
        if (secure) {
          ssl_send_all(tls.get(), response);
          SSL_shutdown(tls.get());
        } else {
          send_all(client.get(), response);
        }
      }));
    }
    for (const auto &[address, session] : sessions.snapshot()) {
      session->stop.store(true);
    }
    pin_ready.notify_all();
    for (auto &worker : workers) {
      worker.wait();
    }
    for (const auto &[address, session] : sessions.snapshot()) {
      session->stop.store(true);
      if (session->video.joinable()) {
        session->video.join();
      }
      if (session->audio.joinable()) {
        session->audio.join();
      }
    }
    return Status::success();
  }

  void GameStreamHost::request_stop() noexcept {
    stop_requested_.store(true);
  }

  HostIdentity default_host_identity() {
    std::array<char, MAX_COMPUTERNAME_LENGTH + 1> hostname {};
    DWORD hostname_size = static_cast<DWORD>(hostname.size());
    if (!GetComputerNameA(hostname.data(), &hostname_size)) {
      std::strcpy(hostname.data(), "Windows-PC");
    }
    const std::string friendly_name = "SpaceViewer - " + std::string(hostname.data());
    const auto first_hash = fnv1a(friendly_name);
    const auto second_hash = fnv1a(friendly_name + ":host");
    char identifier[33] {};
    std::snprintf(
      identifier,
      sizeof(identifier),
      "%016llx%016llx",
      static_cast<unsigned long long>(first_hash),
      static_cast<unsigned long long>(second_hash)
    );
    return {friendly_name, identifier, local_lan_address()};
  }

}  // namespace senaistream
