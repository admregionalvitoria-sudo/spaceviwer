#include "senaistream/gamestream_host.hpp"
#include "senaistream/pairing.hpp"

#include <chrono>
#include <enet/enet.h>
#include <filesystem>
#include <fstream>
#include <gtest/gtest.h>
#include <openssl/pem.h>
#include <openssl/ssl.h>
#include <opus.h>
#include <thread>
#include <winsock2.h>
#include <ws2tcpip.h>

namespace {
  constexpr std::uint16_t test_port = 57089;  ///< Isolated HTTP base, never the production listener.

  /** @brief Converts a loopback peer into the ENet address structure. @param ip IPv4 text. @param port Port. @return Address. */
  ENetAddress address(const char *ip, std::uint16_t port) {
    sockaddr_in raw {};
    raw.sin_family = AF_INET;
    raw.sin_port = htons(port);
    inet_pton(AF_INET, ip, &raw.sin_addr);
    ENetAddress result {};
    enet_address_set_address(&result, reinterpret_cast<sockaddr *>(&raw), sizeof(raw));
    enet_address_set_port(&result, port);
    return result;
  }

  /** @brief Sends one bounded HTTP/TLS request from a distinct LAN-equivalent address.
   * @param ip Source address. @param port Destination port. @param request HTTP text. @param tls Optional TLS context.
   * @return Complete response or error text.
   */
  std::string exchange(const char *ip, std::uint16_t port, const std::string &request, SSL_CTX *tls = nullptr) {
    SOCKET socket = ::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (socket == INVALID_SOCKET) {
      return "socket failed";
    }
    const DWORD timeout = 5000;
    setsockopt(socket, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char *>(&timeout), sizeof(timeout));
    auto local = address(ip, 0);
    auto remote = address("127.0.0.1", port);
    if (bind(socket, reinterpret_cast<const sockaddr *>(&local.address), local.addressLength) || connect(socket, reinterpret_cast<const sockaddr *>(&remote.address), remote.addressLength)) {
      closesocket(socket);
      return "connect failed";
    }
    SSL *ssl = tls ? SSL_new(tls) : nullptr;
    if (ssl) {
      SSL_set_fd(ssl, static_cast<int>(socket));
      if (SSL_connect(ssl) != 1) {
        SSL_free(ssl);
        closesocket(socket);
        return "TLS failed";
      }
      SSL_write(ssl, request.data(), static_cast<int>(request.size()));
    } else {
      send(socket, request.data(), static_cast<int>(request.size()), 0);
    }
    std::string response;
    char buffer[8192];
    int received = 0;
    while ((received = ssl ? SSL_read(ssl, buffer, sizeof(buffer)) : recv(socket, buffer, sizeof(buffer), 0)) > 0) {
      response.append(buffer, received);
    }
    if (ssl) {
      SSL_free(ssl);
    }
    closesocket(socket);
    return response;
  }

  /** @brief Constructs a complete form request. @param endpoint API path. @param body Form content. @return HTTP request. */
  std::string post(const std::string &endpoint, const std::string &body) {
    return "POST " + endpoint + " HTTP/1.1\r\nHost: localhost\r\nContent-Length: " + std::to_string(body.size()) + "\r\n\r\n" + body;
  }

  /** @brief Ensures native test resources are shut down even after an assertion fails. */
  struct LiveHost {
    std::filesystem::path state;  ///< Private test state directory.
    senaistream::GameStreamHost host {{"SpaceViewer Test", "test", "127.0.0.1", test_port, test_port - 5}};  ///< Isolated host.
    std::thread worker;  ///< Server loop.
    ENetHost *first {}, *second {};  ///< Simulated TVs.
    SSL_CTX *tls {};  ///< Paired client identity.
    SOCKET video[2] {INVALID_SOCKET, INVALID_SOCKET};  ///< Optional real capture receivers.
    SOCKET audio[2] {INVALID_SOCKET, INVALID_SOCKET};  ///< Receivers that ping before negotiation.

    /** @brief Pumps client acknowledgements while waiting for video. */
    void pump() {
      for (auto *client : {first, second}) {
        if (client) {
          ENetEvent event {};
          while (enet_host_service(client, &event, 0) > 0) {
            if (event.type == ENET_EVENT_TYPE_RECEIVE) {
              enet_packet_destroy(event.packet);
            }
          }
        }
      }
    }

    /** @brief Waits for an actual video datagram. @param socket Receiver. @return Received byte count. */
    int receive_video(SOCKET socket) {
      char packet[2048];
      for (int i = 0; i < 500; ++i) {
        pump();
        fd_set readable;
        FD_ZERO(&readable);
        FD_SET(socket, &readable);
        timeval timeout {0, 20'000};
        if (select(0, &readable, nullptr, nullptr, &timeout) > 0) {
          return recv(socket, packet, sizeof(packet), 0);
        }
      }
      return 0;
    }

    /** @brief Stops clients before joining and deleting isolated test state. */
    ~LiveHost() {
      if (first) {
        enet_host_destroy(first);
      }
      if (second) {
        enet_host_destroy(second);
      }
      host.request_stop();
      if (worker.joinable()) {
        worker.join();
      }
      for (auto socket : video) {
        if (socket != INVALID_SOCKET) {
          closesocket(socket);
        }
      }
      for (auto socket : audio) {
        if (socket != INVALID_SOCKET) {
          closesocket(socket);
        }
      }
      if (tls) {
        SSL_CTX_free(tls);
      }
      _putenv_s("SPACEVIEWER_DATA_DIR", "");
      std::error_code ignored;
      if (!state.empty()) {
        std::filesystem::remove_all(state, ignored);
      }
      enet_deinitialize();
      WSACleanup();
    }
  };

  /** @brief Owns a tone played into the redirected output, never a user process. */
  struct SharedTone {
    PROCESS_INFORMATION process {};  ///< Owned child handles.

    /** @brief Starts a ten-second tone in the sibling test executable. */
    SharedTone() {
      wchar_t executable[MAX_PATH] {};
      GetModuleFileNameW(nullptr, executable, MAX_PATH);
      const auto path = std::filesystem::path(executable).parent_path() / "test_audio_source.exe";
      std::wstring command = L"\"" + path.wstring() + L"\" 440";
      STARTUPINFOW startup {};
      startup.cb = sizeof(startup);
      CreateProcessW(path.c_str(), command.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW, nullptr, nullptr, &startup, &process);
    }

    /** @brief Stops only the owned tone before local output restoration. */
    ~SharedTone() {
      if (process.hProcess) {
        TerminateProcess(process.hProcess, 0);
        WaitForSingleObject(process.hProcess, 2000);
        CloseHandle(process.hProcess);
        CloseHandle(process.hThread);
      }
    }
  };

  TEST(LiveSessions, TwoControlClientsSurviveCaptureRefreshAndIndependentCancel) {
    WSADATA winsock {};
    ASSERT_EQ(WSAStartup(MAKEWORD(2, 2), &winsock), 0);
    ASSERT_EQ(enet_initialize(), 0);
    const auto state = std::filesystem::temp_directory_path() / ("spaceviewer-live-" + std::to_string(GetCurrentProcessId()));
    _putenv_s("SPACEVIEWER_DATA_DIR", state.string().c_str());
    LiveHost running;
    running.state = state;
    senaistream::PairingManager identity;
    ASSERT_TRUE(identity.initialize(state).ok());
    const auto certificate = identity.host_certificate_pem();
    const auto key = identity.host_private_key_pem();
    // A test-owned certificate is preauthorized, without touching the user's pairings.
    std::ofstream(state / "clients" / "test.pem") << certificate;
    running.tls = SSL_CTX_new(TLS_client_method());
    ASSERT_NE(running.tls, nullptr);
    SSL_CTX_set_verify(running.tls, SSL_VERIFY_NONE, nullptr);
    BIO *cert_bio = BIO_new_mem_buf(certificate.data(), static_cast<int>(certificate.size()));
    BIO *key_bio = BIO_new_mem_buf(key.data(), static_cast<int>(key.size()));
    X509 *cert = PEM_read_bio_X509(cert_bio, nullptr, nullptr, nullptr);
    EVP_PKEY *private_key = PEM_read_bio_PrivateKey(key_bio, nullptr, nullptr, nullptr);
    ASSERT_EQ(SSL_CTX_use_certificate(running.tls, cert), 1);
    ASSERT_EQ(SSL_CTX_use_PrivateKey(running.tls, private_key), 1);
    X509_free(cert);
    EVP_PKEY_free(private_key);
    BIO_free(cert_bio);
    BIO_free(key_bio);
    running.worker = std::thread([&] {
      EXPECT_TRUE(running.host.run().ok());
    });
    const std::string status_request = "GET /api/status HTTP/1.1\r\nHost: localhost\r\n\r\n";
    std::string status;
    for (int i = 0; i < 40; ++i) {
      status = exchange("127.0.0.1", test_port + 1, status_request);
      if (status.find("SpaceViewer") != std::string::npos) {
        break;
      }
      std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    ASSERT_NE(status.find("\"apiVersion\":2"), std::string::npos) << status;
    auto remote = address("127.0.0.1", test_port + 10);
    ENetPeer *second_peer = nullptr;
    int connected = 0;
    for (int i = 0; i < 2; ++i) {
      const char *ip = i == 0 ? "127.0.0.2" : "127.0.0.3";
      const std::string launch = "GET /launch?rikey=" + std::string(32, i == 0 ? '1' : '2') + "&rikeyid=1&mode=320x240x5 HTTP/1.1\r\nHost: localhost\r\n\r\n";
      const auto launched = exchange(ip, test_port - 5, launch, running.tls);
      ASSERT_NE(launched.find("<gamesession>1</gamesession>"), std::string::npos) << launched;
      if (std::getenv("SPACEVIEWER_TEST_AUDIO")) {
        running.audio[i] = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
        auto localAudio = address(ip, 0);
        ASSERT_EQ(bind(running.audio[i], reinterpret_cast<const sockaddr *>(&localAudio.address), localAudio.addressLength), 0);
        auto destination = address("127.0.0.1", test_port + 11);
        ASSERT_EQ(sendto(running.audio[i], "PING", 4, 0, reinterpret_cast<const sockaddr *>(&destination.address), destination.addressLength), 4);
        DWORD timeout = 250;
        setsockopt(running.audio[i], SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char *>(&timeout), sizeof(timeout));
        char premature[1400];
        EXPECT_EQ(recv(running.audio[i], premature, sizeof(premature), 0), SOCKET_ERROR) << "Audio must wait for ANNOUNCE";
      }
      // Reproduce Moonlight's early ping, then negotiate encryption and nondefault duration.
      // Moonlight's SdpGenerator appends a space before CRLF to every attribute.
      const std::string sdp = "a=x-nv-general.featureFlags:167 \r\na=x-nv-aqos.packetDuration:10 \r\n";
      const auto announced = exchange(ip, test_port + 21, "ANNOUNCE rtsp://localhost/ RTSP/1.0\r\nCSeq: 1\r\nContent-length: " + std::to_string(sdp.size()) + "\r\n\r\n" + sdp);
      ASSERT_NE(announced.find("200 OK"), std::string::npos);
      if (std::getenv("SPACEVIEWER_TEST_AUDIO")) {
        DWORD timeout = 5000;
        setsockopt(running.audio[i], SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char *>(&timeout), sizeof(timeout));
        int error = 0;
        auto *decoder = opus_decoder_create(48000, 2, &error);
        ASSERT_EQ(error, OPUS_OK);
        std::uint32_t previous = 0;
        int packetSize = 0;
        for (int frame = 0; frame < 8; ++frame) {
          unsigned char packet[1400], plain[1400], keyBytes[16], iv[16] {};
          std::fill_n(keyBytes, 16, i == 0 ? 0x11 : 0x22);
          const int size = recv(running.audio[i], reinterpret_cast<char *>(packet), sizeof(packet), 0);
          ASSERT_GT(size, 12);
          EXPECT_EQ(packet[1], 97);
          const unsigned sequence = (packet[2] << 8) | packet[3];
          const std::uint32_t timestamp = (std::uint32_t(packet[4]) << 24) | (packet[5] << 16) | (packet[6] << 8) | packet[7];
          if (frame) {
            EXPECT_EQ(timestamp - previous, 10U);
            EXPECT_EQ(size, packetSize);
          }
          previous = timestamp;
          packetSize = size;
          const auto nonce = sequence + 1;
          iv[0] = nonce >> 24;
          iv[1] = nonce >> 16;
          iv[2] = nonce >> 8;
          iv[3] = nonce;
          auto *context = EVP_CIPHER_CTX_new();
          ASSERT_NE(context, nullptr);
          int written = 0, finalBytes = 0;
          ASSERT_EQ(EVP_DecryptInit_ex(context, EVP_aes_128_cbc(), nullptr, keyBytes, iv), 1);
          ASSERT_EQ(EVP_DecryptUpdate(context, plain, &written, packet + 12, size - 12), 1);
          const auto valid = EVP_DecryptFinal_ex(context, plain + written, &finalBytes);
          EVP_CIPHER_CTX_free(context);
          ASSERT_EQ(valid, 1) << "Moonlight must decrypt audio using negotiated per-TV keys";
          float pcm[960];
          EXPECT_EQ(opus_decode_float(decoder, plain, written + finalBytes, pcm, 480, 0), 480);
        }
        opus_decoder_destroy(decoder);
      }
      auto local = address(ip, 0);
      auto *client = enet_host_create(AF_INET, &local, 1, 48, 0, 0);
      ASSERT_NE(client, nullptr);
      if (i == 0) {
        running.first = client;
      } else {
        running.second = client;
      }
      auto *peer = enet_host_connect(client, &remote, 48, 0);
      ASSERT_NE(peer, nullptr);
      if (i == 1) {
        second_peer = peer;
      }
      ENetEvent event {};
      for (int attempt = 0; attempt < 50; ++attempt) {
        if (enet_host_service(client, &event, 100) > 0 && event.type == ENET_EVENT_TYPE_CONNECT) {
          ++connected;
          enet_host_flush(client);
          break;
        }
      }
    }
    ASSERT_EQ(connected, 2);
    if (std::getenv("SPACEVIEWER_TEST_AUDIO")) {
      for (int attempt = 0; attempt < 30; ++attempt) {
        running.pump();
        status = exchange("127.0.0.1", test_port + 1, "GET /api/audio-status HTTP/1.1\r\nHost: localhost\r\n\r\n");
        if (status.find("\"redirected\":true") != std::string::npos) {
          break;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
      }
      ASSERT_NE(status.find("\"redirected\":true"), std::string::npos) << status;
      SharedTone tone;
      ASSERT_NE(tone.process.dwProcessId, 0U);
      double energy[2] {};
      int error = 0;
      OpusDecoder *decoders[2] {opus_decoder_create(48000, 2, &error), opus_decoder_create(48000, 2, &error)};
      for (int frame = 0; frame < 150; ++frame) {
        running.pump();
        for (int index = 0; index < 2; ++index) {
          unsigned char packet[1400], plain[1400], key[16], iv[16] {};
          const int size = recv(running.audio[index], reinterpret_cast<char *>(packet), sizeof(packet), 0);
          ASSERT_GT(size, 12);
          std::fill_n(key, 16, index == 0 ? 0x11 : 0x22);
          const unsigned nonce = ((packet[2] << 8) | packet[3]) + 1;
          iv[0] = nonce >> 24;
          iv[1] = nonce >> 16;
          iv[2] = nonce >> 8;
          iv[3] = nonce;
          auto *context = EVP_CIPHER_CTX_new();
          int length = 0, tail = 0;
          ASSERT_EQ(EVP_DecryptInit_ex(context, EVP_aes_128_cbc(), nullptr, key, iv), 1);
          ASSERT_EQ(EVP_DecryptUpdate(context, plain, &length, packet + 12, size - 12), 1);
          const int result = EVP_DecryptFinal_ex(context, plain + length, &tail);
          EVP_CIPHER_CTX_free(context);
          ASSERT_EQ(result, 1);
          float pcm[960];
          const int samples = opus_decode_float(decoders[index], plain, length + tail, pcm, 480, 0);
          ASSERT_EQ(samples, 480);
          for (int sample = 0; sample < samples * 2; ++sample) {
            energy[index] += pcm[sample] * pcm[sample];
          }
        }
      }
      for (auto *decoder : decoders) {
        opus_decoder_destroy(decoder);
      }
      EXPECT_GT(energy[0], 1.0) << "First TV must receive audible shared audio, not just valid silence packets";
      EXPECT_GT(energy[1], 1.0) << "Second TV must receive audible shared audio simultaneously";
      std::cout << "Shared audio decoded energies: " << energy[0] << ", " << energy[1] << '\n';
      EXPECT_NE(exchange("127.0.0.1", test_port + 1, post("/api/session-audio", "address=127.0.0.2&window=0")).find("200 OK"), std::string::npos);
      EXPECT_NE(exchange("127.0.0.1", test_port + 1, "GET /api/audio-status HTTP/1.1\r\nHost: localhost\r\n\r\n").find("\"redirected\":true"), std::string::npos);
      EXPECT_NE(exchange("127.0.0.1", test_port + 1, post("/api/session-audio", "address=127.0.0.2&window=0&mode=system")).find("200 OK"), std::string::npos);
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(150));
    status = exchange("127.0.0.1", test_port + 1, status_request);
    EXPECT_NE(status.find("\"activeClients\":2"), std::string::npos) << status;
    if (std::getenv("SPACEVIEWER_TEST_CAPTURE")) {
      const auto configured = exchange("127.0.0.1", test_port + 1, post("/api/settings", "display=0&width=320&height=240&fps=5&bitrateMbps=1&hardware=0&virtualDisplay=0"));
      ASSERT_NE(configured.find("200 OK"), std::string::npos) << configured;
      for (int i = 0; i < 2; ++i) {
        running.video[i] = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
        auto local = address(i == 0 ? "127.0.0.2" : "127.0.0.3", 0);
        ASSERT_EQ(bind(running.video[i], reinterpret_cast<const sockaddr *>(&local.address), local.addressLength), 0);
        auto destination = address("127.0.0.1", test_port + 9);
        ASSERT_EQ(sendto(running.video[i], "PING", 4, 0, reinterpret_cast<const sockaddr *>(&destination.address), destination.addressLength), 4);
      }
      EXPECT_GT(running.receive_video(running.video[0]), 16);
      EXPECT_GT(running.receive_video(running.video[1]), 16);
    }
    EXPECT_NE(exchange("127.0.0.1", test_port + 1, post("/api/refresh-capture", "")).find("200 OK"), std::string::npos);
    if (std::getenv("SPACEVIEWER_TEST_CAPTURE")) {
      for (int i = 0; i < 30; ++i) {
        running.pump();
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
      }
      for (auto socket : running.video) {
        u_long nonblocking = 1;
        ioctlsocket(socket, FIONBIO, &nonblocking);
        char stale[2048];
        while (recv(socket, stale, sizeof(stale), 0) > 0) {}
        nonblocking = 0;
        ioctlsocket(socket, FIONBIO, &nonblocking);
        EXPECT_GT(running.receive_video(socket), 16);
      }
    }
    EXPECT_NE(exchange("127.0.0.1", test_port + 1, status_request).find("\"activeClients\":2"), std::string::npos);
    const auto cancel = exchange("127.0.0.2", test_port - 5, "GET /cancel HTTP/1.1\r\nHost: localhost\r\n\r\n", running.tls);
    EXPECT_NE(cancel.find("<gamesession>1</gamesession>"), std::string::npos);
    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    status = exchange("127.0.0.1", test_port + 1, status_request);
    EXPECT_NE(status.find("\"activeClients\":1"), std::string::npos) << status;
    EXPECT_EQ(second_peer->state, ENET_PEER_STATE_CONNECTED);
    if (std::getenv("SPACEVIEWER_TEST_CAPTURE")) {
      EXPECT_NE(exchange("127.0.0.1", test_port + 1, post("/api/session-display", "address=127.0.0.3&display=0")).find("200 OK"), std::string::npos);
      EXPECT_EQ(exchange("127.0.0.1", test_port + 1, post("/api/session-display", "address=127.0.0.3&display=999")).find("200 OK"), std::string::npos);
      u_long nonblocking = 1;
      ioctlsocket(running.video[1], FIONBIO, &nonblocking);
      char stale[2048];
      while (recv(running.video[1], stale, sizeof(stale), 0) > 0) {}
      nonblocking = 0;
      ioctlsocket(running.video[1], FIONBIO, &nonblocking);
      EXPECT_GT(running.receive_video(running.video[1]), 16);
    }
  }
}  // namespace
