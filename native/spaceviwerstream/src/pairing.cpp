#include "senaistream/pairing.hpp"

// DPAPI headers require Windows types first.
// clang-format off
#include <windows.h>
#include <wincrypt.h>
// clang-format on

#include <algorithm>
#include <array>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <map>
#include <memory>
#include <mutex>
#include <openssl/evp.h>
#include <openssl/pem.h>
#include <openssl/rand.h>
#include <openssl/x509.h>
#include <set>
#include <sstream>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace {

  /**
   * @brief Releases an OpenSSL key.
   */
  struct KeyDeleter {
    /**
     * @brief Releases a key.
     *
     * @param value Key to release.
     */
    void operator()(EVP_PKEY *value) const noexcept {
      EVP_PKEY_free(value);
    }
  };

  /**
   * @brief Releases an OpenSSL certificate.
   */
  struct CertificateDeleter {
    /**
     * @brief Releases a certificate.
     *
     * @param value Certificate to release.
     */
    void operator()(X509 *value) const noexcept {
      X509_free(value);
    }
  };

  /**
   * @brief Releases an OpenSSL memory BIO.
   */
  struct BioDeleter {
    /**
     * @brief Releases a BIO.
     *
     * @param value BIO to release.
     */
    void operator()(BIO *value) const noexcept {
      BIO_free(value);
    }
  };

  using KeyPointer = std::unique_ptr<EVP_PKEY, KeyDeleter>;
  using CertificatePointer = std::unique_ptr<X509, CertificateDeleter>;
  using BioPointer = std::unique_ptr<BIO, BioDeleter>;

  /**
   * @brief Converts one hexadecimal nibble.
   *
   * @param character ASCII hexadecimal character.
   * @return Nibble value or -1 for invalid input.
   */
  int hex_nibble(char character) {
    if (character >= '0' && character <= '9') {
      return character - '0';
    }
    if (character >= 'a' && character <= 'f') {
      return character - 'a' + 10;
    }
    if (character >= 'A' && character <= 'F') {
      return character - 'A' + 10;
    }
    return -1;
  }

  /**
   * @brief Decodes hexadecimal bytes.
   *
   * @param text Hexadecimal text.
   * @param output Receives decoded bytes.
   * @return True when the input is valid.
   */
  bool decode_hex(std::string_view text, std::vector<std::uint8_t> &output) {
    if ((text.size() & 1U) != 0) {
      return false;
    }
    output.clear();
    output.reserve(text.size() / 2);
    for (std::size_t index = 0; index < text.size(); index += 2) {
      const auto high = hex_nibble(text[index]);
      const auto low = hex_nibble(text[index + 1]);
      if (high < 0 || low < 0) {
        output.clear();
        return false;
      }
      output.push_back(static_cast<std::uint8_t>((high << 4) | low));
    }
    return true;
  }

  /**
   * @brief Encodes bytes as lowercase hexadecimal text.
   *
   * @param bytes Bytes to encode.
   * @return Hexadecimal representation.
   */
  std::string encode_hex(const std::vector<std::uint8_t> &bytes) {
    constexpr std::string_view digits = "0123456789abcdef";
    std::string text;
    text.resize(bytes.size() * 2);
    for (std::size_t index = 0; index < bytes.size(); ++index) {
      text[index * 2] = digits[bytes[index] >> 4];
      text[index * 2 + 1] = digits[bytes[index] & 0x0F];
    }
    return text;
  }

  /**
   * @brief Decodes percent escapes in a URL query value.
   *
   * @param text Encoded query value.
   * @return Decoded value.
   */
  std::string url_decode(std::string_view text) {
    std::string value;
    value.reserve(text.size());
    for (std::size_t index = 0; index < text.size(); ++index) {
      if (text[index] == '%' && index + 2 < text.size()) {
        const auto high = hex_nibble(text[index + 1]);
        const auto low = hex_nibble(text[index + 2]);
        if (high >= 0 && low >= 0) {
          value.push_back(static_cast<char>((high << 4) | low));
          index += 2;
          continue;
        }
      }
      value.push_back(text[index] == '+' ? ' ' : text[index]);
    }
    return value;
  }

  /**
   * @brief Parses a URL query into decoded key/value pairs.
   *
   * @param target Request target containing an optional query.
   * @return Parsed query map.
   */
  std::map<std::string, std::string> parse_query(std::string_view target) {
    std::map<std::string, std::string> values;
    const auto question = target.find('?');
    if (question == std::string_view::npos) {
      return values;
    }
    auto query = target.substr(question + 1);
    while (!query.empty()) {
      const auto separator = query.find('&');
      const auto item = query.substr(0, separator);
      const auto equals = item.find('=');
      values[url_decode(item.substr(0, equals))] = equals == std::string_view::npos ? "" : url_decode(item.substr(equals + 1));
      if (separator == std::string_view::npos) {
        break;
      }
      query.remove_prefix(separator + 1);
    }
    return values;
  }

  /**
   * @brief Creates a standard pairing response document.
   *
   * @param paired Whether the phase succeeded.
   * @param element Optional response element name.
   * @param value Optional response element value.
   * @param message Status message.
   * @return XML document.
   */
  std::string pairing_xml(bool paired, std::string_view element = {}, std::string_view value = {}, std::string_view message = "OK") {
    std::ostringstream xml;
    xml << "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
        << "<root status_code=\"" << (paired ? 200 : 400) << "\" status_message=\"" << message << "\">"
        << "<paired>" << (paired ? 1 : 0) << "</paired>";
    if (!element.empty()) {
      xml << '<' << element << '>' << value << "</" << element << '>';
    }
    xml << "</root>";
    return xml.str();
  }

  /**
   * @brief Computes SHA-256 over a list of byte spans.
   *
   * @param parts Byte vectors to hash in order.
   * @return Digest bytes, or an empty vector on failure.
   */
  std::vector<std::uint8_t> sha256(const std::vector<std::vector<std::uint8_t>> &parts) {
    std::vector<std::uint8_t> digest(EVP_MAX_MD_SIZE);
    unsigned int digest_size = 0;
    EVP_MD_CTX *raw_context = EVP_MD_CTX_new();
    if (raw_context == nullptr) {
      return {};
    }
    std::unique_ptr<EVP_MD_CTX, decltype(&EVP_MD_CTX_free)> context(raw_context, EVP_MD_CTX_free);
    if (EVP_DigestInit_ex(context.get(), EVP_sha256(), nullptr) != 1) {
      return {};
    }
    for (const auto &part : parts) {
      if (!part.empty() && EVP_DigestUpdate(context.get(), part.data(), part.size()) != 1) {
        return {};
      }
    }
    if (EVP_DigestFinal_ex(context.get(), digest.data(), &digest_size) != 1) {
      return {};
    }
    digest.resize(digest_size);
    return digest;
  }

  /**
   * @brief Encrypts or decrypts complete AES-128-ECB blocks without padding.
   *
   * @param input Input bytes whose size is a multiple of 16.
   * @param key AES-128 key.
   * @param encrypt Whether to encrypt rather than decrypt.
   * @return Transformed bytes, or an empty vector on failure.
   */
  std::vector<std::uint8_t> aes_ecb(
    const std::vector<std::uint8_t> &input,
    const std::array<std::uint8_t, 16> &key,
    bool encrypt
  ) {
    if (input.empty() || (input.size() % 16) != 0) {
      return {};
    }
    EVP_CIPHER_CTX *raw_context = EVP_CIPHER_CTX_new();
    if (raw_context == nullptr) {
      return {};
    }
    std::unique_ptr<EVP_CIPHER_CTX, decltype(&EVP_CIPHER_CTX_free)> context(raw_context, EVP_CIPHER_CTX_free);
    if (EVP_CipherInit_ex(context.get(), EVP_aes_128_ecb(), nullptr, key.data(), nullptr, encrypt ? 1 : 0) != 1 || EVP_CIPHER_CTX_set_padding(context.get(), 0) != 1) {
      return {};
    }
    std::vector<std::uint8_t> output(input.size() + 16);
    int first_size = 0;
    int final_size = 0;
    if (EVP_CipherUpdate(context.get(), output.data(), &first_size, input.data(), static_cast<int>(input.size())) != 1 || EVP_CipherFinal_ex(context.get(), output.data() + first_size, &final_size) != 1) {
      return {};
    }
    output.resize(static_cast<std::size_t>(first_size + final_size));
    return output;
  }

  /**
   * @brief Extracts the raw signature stored in a certificate.
   *
   * @param certificate Certificate to inspect.
   * @return Signature bytes.
   */
  std::vector<std::uint8_t> certificate_signature(X509 *certificate) {
    const ASN1_BIT_STRING *signature = nullptr;
    const X509_ALGOR *algorithm = nullptr;
    X509_get0_signature(&signature, &algorithm, certificate);
    if (signature == nullptr || signature->data == nullptr || signature->length <= 0) {
      return {};
    }
    return {signature->data, signature->data + signature->length};
  }

  /**
   * @brief Signs bytes with RSA and SHA-256.
   *
   * @param key Private key.
   * @param data Bytes to sign.
   * @return Signature bytes.
   */
  std::vector<std::uint8_t> sign_bytes(EVP_PKEY *key, const std::vector<std::uint8_t> &data) {
    EVP_MD_CTX *raw_context = EVP_MD_CTX_new();
    if (raw_context == nullptr) {
      return {};
    }
    std::unique_ptr<EVP_MD_CTX, decltype(&EVP_MD_CTX_free)> context(raw_context, EVP_MD_CTX_free);
    if (EVP_DigestSignInit(context.get(), nullptr, EVP_sha256(), nullptr, key) != 1 || EVP_DigestSignUpdate(context.get(), data.data(), data.size()) != 1) {
      return {};
    }
    std::size_t size = 0;
    if (EVP_DigestSignFinal(context.get(), nullptr, &size) != 1) {
      return {};
    }
    std::vector<std::uint8_t> signature(size);
    if (EVP_DigestSignFinal(context.get(), signature.data(), &size) != 1) {
      return {};
    }
    signature.resize(size);
    return signature;
  }

  /**
   * @brief Verifies an RSA SHA-256 signature.
   *
   * @param certificate Certificate containing the public key.
   * @param data Signed bytes.
   * @param signature Signature bytes.
   * @return True when the signature is valid.
   */
  bool verify_bytes(X509 *certificate, const std::vector<std::uint8_t> &data, const std::vector<std::uint8_t> &signature) {
    KeyPointer public_key(X509_get_pubkey(certificate));
    EVP_MD_CTX *raw_context = EVP_MD_CTX_new();
    if (!public_key || raw_context == nullptr) {
      EVP_MD_CTX_free(raw_context);
      return false;
    }
    std::unique_ptr<EVP_MD_CTX, decltype(&EVP_MD_CTX_free)> context(raw_context, EVP_MD_CTX_free);
    return EVP_DigestVerifyInit(context.get(), nullptr, EVP_sha256(), nullptr, public_key.get()) == 1 &&
           EVP_DigestVerifyUpdate(context.get(), data.data(), data.size()) == 1 &&
           EVP_DigestVerifyFinal(context.get(), signature.data(), signature.size()) == 1;
  }

  /**
   * @brief Encodes a certificate as PEM.
   *
   * @param certificate Certificate to encode.
   * @return PEM text or empty text on failure.
   */
  std::string certificate_to_pem(X509 *certificate) {
    BioPointer bio(BIO_new(BIO_s_mem()));
    if (!bio || PEM_write_bio_X509(bio.get(), certificate) != 1) {
      return {};
    }
    BUF_MEM *memory = nullptr;
    BIO_get_mem_ptr(bio.get(), &memory);
    return memory == nullptr ? std::string {} : std::string(memory->data, memory->length);
  }

  /**
   * @brief Parses a PEM certificate.
   *
   * @param pem PEM text.
   * @return Parsed certificate or null on failure.
   */
  CertificatePointer parse_certificate(std::string_view pem) {
    BioPointer bio(BIO_new_mem_buf(pem.data(), static_cast<int>(pem.size())));
    return CertificatePointer(bio ? PEM_read_bio_X509(bio.get(), nullptr, nullptr, nullptr) : nullptr);
  }

  /**
   * @brief Parses a PEM private key.
   *
   * @param pem PEM text.
   * @return Parsed private key or null on failure.
   */
  KeyPointer parse_private_key(std::string_view pem) {
    BioPointer bio(BIO_new_mem_buf(pem.data(), static_cast<int>(pem.size())));
    return KeyPointer(bio ? PEM_read_bio_PrivateKey(bio.get(), nullptr, nullptr, nullptr) : nullptr);
  }

  /**
   * @brief Computes a stable SHA-256 certificate fingerprint.
   *
   * @param certificate Certificate to fingerprint.
   * @return Lowercase hexadecimal fingerprint.
   */
  std::string certificate_fingerprint(X509 *certificate) {
    const auto encoded_size = i2d_X509(certificate, nullptr);
    if (encoded_size <= 0) {
      return {};
    }
    std::vector<std::uint8_t> encoded(static_cast<std::size_t>(encoded_size));
    auto *cursor = encoded.data();
    if (i2d_X509(certificate, &cursor) != encoded_size) {
      return {};
    }
    return encode_hex(sha256({encoded}));
  }

  /**
   * @brief Reads an entire binary file.
   *
   * @param path Source path.
   * @return File bytes, or an empty vector on failure.
   */
  std::vector<std::uint8_t> read_file(const std::filesystem::path &path) {
    std::ifstream stream(path, std::ios::binary);
    if (!stream) {
      return {};
    }
    return {std::istreambuf_iterator<char>(stream), std::istreambuf_iterator<char>()};
  }

  /**
   * @brief Writes all bytes to a binary file.
   *
   * @param path Destination path.
   * @param bytes Bytes to write.
   * @return True when the write succeeds.
   */
  bool write_file(const std::filesystem::path &path, const std::vector<std::uint8_t> &bytes) {
    std::ofstream stream(path, std::ios::binary | std::ios::trunc);
    stream.write(reinterpret_cast<const char *>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
    return stream.good();
  }

  /**
   * @brief Protects private-key bytes with machine-scoped Windows DPAPI.
   *
   * @param plain Unprotected bytes.
   * @return Protected blob, or an empty vector on failure.
   */
  std::vector<std::uint8_t> protect_key(const std::vector<std::uint8_t> &plain) {
    if (plain.empty() || plain.size() > std::numeric_limits<DWORD>::max()) {
      return {};
    }
    DATA_BLOB input {static_cast<DWORD>(plain.size()), const_cast<BYTE *>(plain.data())};
    DATA_BLOB output {};
    if (!CryptProtectData(&input, L"SenaiStream host key", nullptr, nullptr, nullptr, CRYPTPROTECT_LOCAL_MACHINE, &output)) {
      return {};
    }
    std::vector<std::uint8_t> protected_bytes(output.pbData, output.pbData + output.cbData);
    LocalFree(output.pbData);
    return protected_bytes;
  }

  /**
   * @brief Unprotects private-key bytes with Windows DPAPI.
   *
   * @param protected_bytes Protected blob.
   * @return Plain bytes, or an empty vector on failure.
   */
  std::vector<std::uint8_t> unprotect_key(const std::vector<std::uint8_t> &protected_bytes) {
    if (protected_bytes.empty() || protected_bytes.size() > std::numeric_limits<DWORD>::max()) {
      return {};
    }
    DATA_BLOB input {static_cast<DWORD>(protected_bytes.size()), const_cast<BYTE *>(protected_bytes.data())};
    DATA_BLOB output {};
    if (!CryptUnprotectData(&input, nullptr, nullptr, nullptr, nullptr, 0, &output)) {
      return {};
    }
    std::vector<std::uint8_t> plain(output.pbData, output.pbData + output.cbData);
    LocalFree(output.pbData);
    return plain;
  }

}  // namespace

namespace senaistream {

  /**
   * @brief Stores one in-progress pairing exchange.
   */
  struct PairingSession {
    std::array<std::uint8_t, 16> aes_key {};  ///< Key derived from salt and PIN.
    CertificatePointer client_certificate;  ///< Client certificate supplied in phase one.
    std::string client_certificate_pem;  ///< Client certificate PEM for persistence after verification.
    std::vector<std::uint8_t> client_challenge;  ///< Client challenge decrypted in phase two.
    std::vector<std::uint8_t> server_challenge;  ///< Random server challenge.
    std::vector<std::uint8_t> server_secret;  ///< Random secret signed by the server.
    std::vector<std::uint8_t> client_response_hash;  ///< Client proof retained until its signed secret arrives.
    unsigned int phase {};  ///< Last successfully completed phase.
  };

  class PairingManager::Implementation {
  public:
    KeyPointer host_key;  ///< Ephemeral host private key.
    CertificatePointer host_certificate;  ///< Ephemeral host certificate.
    std::string host_certificate_pem;  ///< PEM representation returned to clients.
    std::string host_private_key_pem;  ///< PEM private key used by the TLS listener.
    std::map<std::string, PairingSession> sessions;  ///< Pairing state keyed by client unique ID.
    std::set<std::string> authorized_fingerprints;  ///< Persisted paired client fingerprints.
    std::filesystem::path state_directory;  ///< Directory containing protected pairing state.
    std::mutex mutex;  ///< Protects pairing sessions.
  };

  PairingManager::PairingManager():
      implementation_(std::make_unique<Implementation>()) {
  }

  PairingManager::~PairingManager() = default;

  Status PairingManager::initialize(const std::filesystem::path &state_directory) {
    if (state_directory.empty() && std::getenv("SPACEVIEWER_DATA_DIR")) {
      implementation_->state_directory = std::getenv("SPACEVIEWER_DATA_DIR");
    } else if (state_directory.empty()) {
      const auto *local_app_data = std::getenv("LOCALAPPDATA");
      implementation_->state_directory = local_app_data == nullptr ? std::filesystem::current_path() / "senaistream-state" :
                                                                     std::filesystem::path(local_app_data) / "SpaceViewer";
    } else {
      implementation_->state_directory = state_directory;
    }
    std::error_code filesystem_error;
    std::filesystem::create_directories(implementation_->state_directory / "clients", filesystem_error);
    if (filesystem_error) {
      return Status::failure("Unable to create the pairing state directory: " + filesystem_error.message());
    }

    const auto certificate_path = implementation_->state_directory / "host-certificate.pem";
    const auto key_path = implementation_->state_directory / "host-private-key.dpapi";
    const auto certificate_bytes = read_file(certificate_path);
    const auto protected_key = read_file(key_path);
    if (!certificate_bytes.empty() && !protected_key.empty()) {
      const auto key_bytes = unprotect_key(protected_key);
      const std::string certificate_pem(certificate_bytes.begin(), certificate_bytes.end());
      const std::string key_pem(key_bytes.begin(), key_bytes.end());
      auto certificate = parse_certificate(certificate_pem);
      auto key = parse_private_key(key_pem);
      if (certificate && key && X509_check_private_key(certificate.get(), key.get()) == 1) {
        implementation_->host_certificate = std::move(certificate);
        implementation_->host_key = std::move(key);
        implementation_->host_certificate_pem = certificate_pem;
        implementation_->host_private_key_pem = key_pem;
      }
    }

    for (const auto &entry : std::filesystem::directory_iterator(implementation_->state_directory / "clients", filesystem_error)) {
      if (filesystem_error || !entry.is_regular_file()) {
        continue;
      }
      const auto bytes = read_file(entry.path());
      const std::string pem(bytes.begin(), bytes.end());
      auto certificate = parse_certificate(pem);
      if (certificate) {
        implementation_->authorized_fingerprints.insert(certificate_fingerprint(certificate.get()));
      }
    }
    if (implementation_->host_certificate && implementation_->host_key) {
      return Status::success();
    }

    EVP_PKEY_CTX *raw_key_context = EVP_PKEY_CTX_new_id(EVP_PKEY_RSA, nullptr);
    if (raw_key_context == nullptr) {
      return Status::failure("Unable to create the RSA key context");
    }
    std::unique_ptr<EVP_PKEY_CTX, decltype(&EVP_PKEY_CTX_free)> key_context(raw_key_context, EVP_PKEY_CTX_free);
    EVP_PKEY *raw_key = nullptr;
    if (EVP_PKEY_keygen_init(key_context.get()) != 1 || EVP_PKEY_CTX_set_rsa_keygen_bits(key_context.get(), 2048) != 1 || EVP_PKEY_keygen(key_context.get(), &raw_key) != 1) {
      return Status::failure("Unable to generate the RSA host key");
    }
    implementation_->host_key.reset(raw_key);
    implementation_->host_certificate.reset(X509_new());
    if (!implementation_->host_certificate) {
      return Status::failure("Unable to allocate the host certificate");
    }
    X509 *certificate = implementation_->host_certificate.get();
    X509_set_version(certificate, 2);
    ASN1_INTEGER_set(X509_get_serialNumber(certificate), static_cast<long>(std::chrono::system_clock::now().time_since_epoch().count() & 0x7FFFFFFF));
    X509_gmtime_adj(X509_getm_notBefore(certificate), 0);
    X509_gmtime_adj(X509_getm_notAfter(certificate), 10L * 365 * 24 * 60 * 60);
    X509_set_pubkey(certificate, implementation_->host_key.get());
    X509_NAME *subject = X509_get_subject_name(certificate);
    X509_NAME_add_entry_by_txt(subject, "CN", MBSTRING_ASC, reinterpret_cast<const unsigned char *>("SenaiStream"), -1, -1, 0);
    X509_set_issuer_name(certificate, subject);
    if (X509_sign(certificate, implementation_->host_key.get(), EVP_sha256()) == 0) {
      return Status::failure("Unable to sign the host certificate");
    }
    BioPointer bio(BIO_new(BIO_s_mem()));
    if (!bio || PEM_write_bio_X509(bio.get(), certificate) != 1) {
      return Status::failure("Unable to encode the host certificate");
    }
    BUF_MEM *memory = nullptr;
    BIO_get_mem_ptr(bio.get(), &memory);
    implementation_->host_certificate_pem.assign(memory->data, memory->length);
    BioPointer key_bio(BIO_new(BIO_s_mem()));
    if (!key_bio || PEM_write_bio_PrivateKey(key_bio.get(), implementation_->host_key.get(), nullptr, nullptr, 0, nullptr, nullptr) != 1) {
      return Status::failure("Unable to encode the host private key");
    }
    memory = nullptr;
    BIO_get_mem_ptr(key_bio.get(), &memory);
    implementation_->host_private_key_pem.assign(memory->data, memory->length);
    const std::vector<std::uint8_t> certificate_file(
      implementation_->host_certificate_pem.begin(),
      implementation_->host_certificate_pem.end()
    );
    const std::vector<std::uint8_t> key_file(
      implementation_->host_private_key_pem.begin(),
      implementation_->host_private_key_pem.end()
    );
    const auto protected_key_file = protect_key(key_file);
    if (protected_key_file.empty() || !write_file(certificate_path, certificate_file) || !write_file(key_path, protected_key_file)) {
      return Status::failure("Unable to persist the protected host identity");
    }
    return Status::success();
  }

  std::string PairingManager::handle_request(
    std::string_view request_target,
    const std::function<std::string()> &pin_provider
  ) {
    const auto query = parse_query(request_target);
    const auto unique_iterator = query.find("uniqueid");
    if (unique_iterator == query.end() || unique_iterator->second.empty()) {
      return pairing_xml(false, {}, {}, "Missing client identity");
    }
    const auto &client_id = unique_iterator->second;
    const auto phrase_iterator = query.find("phrase");
    const bool certificate_request = phrase_iterator != query.end() && phrase_iterator->second == "getservercert";
    std::string supplied_pin;
    if (certificate_request) {
      supplied_pin = pin_provider();
    }

    std::lock_guard lock(implementation_->mutex);
    if (certificate_request) {
      std::vector<std::uint8_t> salt;
      std::vector<std::uint8_t> certificate_bytes;
      if (!decode_hex(query.contains("salt") ? query.at("salt") : "", salt) || salt.size() != 16 || !decode_hex(query.contains("clientcert") ? query.at("clientcert") : "", certificate_bytes)) {
        return pairing_xml(false, {}, {}, "Invalid certificate request");
      }
      const std::string certificate_pem(certificate_bytes.begin(), certificate_bytes.end());
      BioPointer certificate_bio(BIO_new_mem_buf(certificate_pem.data(), static_cast<int>(certificate_pem.size())));
      CertificatePointer client_certificate(PEM_read_bio_X509(certificate_bio.get(), nullptr, nullptr, nullptr));
      if (!client_certificate) {
        return pairing_xml(false, {}, {}, "Invalid client certificate");
      }
      if (supplied_pin.size() != 4 || !std::all_of(supplied_pin.begin(), supplied_pin.end(), [](char value) {
            return value >= '0' && value <= '9';
          })) {
        return pairing_xml(false, {}, {}, "Pairing PIN was not supplied");
      }
      std::vector<std::uint8_t> pin_bytes(supplied_pin.begin(), supplied_pin.end());
      auto key_digest = sha256({salt, pin_bytes});
      if (key_digest.size() < 16) {
        return pairing_xml(false, {}, {}, "PIN key derivation failed");
      }
      PairingSession session;
      std::copy_n(key_digest.begin(), session.aes_key.size(), session.aes_key.begin());
      session.client_certificate = std::move(client_certificate);
      session.client_certificate_pem = certificate_to_pem(session.client_certificate.get());
      if (session.client_certificate_pem.empty()) {
        return pairing_xml(false, {}, {}, "Client certificate encoding failed");
      }
      session.phase = 1;
      implementation_->sessions[client_id] = std::move(session);
      const std::vector<std::uint8_t> host_pem(
        implementation_->host_certificate_pem.begin(),
        implementation_->host_certificate_pem.end()
      );
      return pairing_xml(true, "plaincert", encode_hex(host_pem));
    }

    auto session_iterator = implementation_->sessions.find(client_id);
    if (session_iterator == implementation_->sessions.end()) {
      return pairing_xml(false, {}, {}, "Unknown pairing session");
    }
    auto &session = session_iterator->second;

    if (query.contains("clientchallenge") && session.phase == 1) {
      std::vector<std::uint8_t> encrypted;
      if (!decode_hex(query.at("clientchallenge"), encrypted)) {
        return pairing_xml(false, {}, {}, "Invalid client challenge");
      }
      session.client_challenge = aes_ecb(encrypted, session.aes_key, false);
      session.server_secret.resize(16);
      session.server_challenge.resize(16);
      if (session.client_challenge.empty() || RAND_bytes(session.server_secret.data(), 16) != 1 || RAND_bytes(session.server_challenge.data(), 16) != 1) {
        return pairing_xml(false, {}, {}, "Challenge generation failed");
      }
      auto digest = sha256({session.client_challenge, certificate_signature(implementation_->host_certificate.get()), session.server_secret});
      digest.insert(digest.end(), session.server_challenge.begin(), session.server_challenge.end());
      const auto response = aes_ecb(digest, session.aes_key, true);
      if (response.empty()) {
        return pairing_xml(false, {}, {}, "Challenge encryption failed");
      }
      session.phase = 2;
      return pairing_xml(true, "challengeresponse", encode_hex(response));
    }

    if (query.contains("serverchallengeresp") && session.phase == 2) {
      std::vector<std::uint8_t> encrypted;
      if (!decode_hex(query.at("serverchallengeresp"), encrypted)) {
        return pairing_xml(false, {}, {}, "Invalid server challenge response");
      }
      const auto plain = aes_ecb(encrypted, session.aes_key, false);
      if (plain.size() != 32) {
        return pairing_xml(false, {}, {}, "Unexpected challenge response size");
      }
      session.client_response_hash = plain;
      auto secret_and_signature = session.server_secret;
      const auto signature = sign_bytes(implementation_->host_key.get(), session.server_secret);
      if (signature.empty()) {
        return pairing_xml(false, {}, {}, "Server signature failed");
      }
      secret_and_signature.insert(secret_and_signature.end(), signature.begin(), signature.end());
      session.phase = 3;
      return pairing_xml(true, "pairingsecret", encode_hex(secret_and_signature));
    }

    if (query.contains("clientpairingsecret") && session.phase == 3) {
      std::vector<std::uint8_t> secret_and_signature;
      if (!decode_hex(query.at("clientpairingsecret"), secret_and_signature) || secret_and_signature.size() <= 16) {
        return pairing_xml(false, {}, {}, "Invalid client pairing secret");
      }
      const std::vector<std::uint8_t> secret(secret_and_signature.begin(), secret_and_signature.begin() + 16);
      const std::vector<std::uint8_t> signature(secret_and_signature.begin() + 16, secret_and_signature.end());
      const auto expected_hash = sha256({session.server_challenge, certificate_signature(session.client_certificate.get()), secret});
      if (expected_hash != session.client_response_hash || !verify_bytes(session.client_certificate.get(), secret, signature)) {
        return pairing_xml(false, {}, {}, "Client signature did not match");
      }
      const auto fingerprint = certificate_fingerprint(session.client_certificate.get());
      if (fingerprint.empty()) {
        return pairing_xml(false, {}, {}, "Client fingerprint failed");
      }
      const std::vector<std::uint8_t> certificate_file(
        session.client_certificate_pem.begin(),
        session.client_certificate_pem.end()
      );
      if (!write_file(implementation_->state_directory / "clients" / (fingerprint + ".pem"), certificate_file)) {
        return pairing_xml(false, {}, {}, "Unable to persist paired client");
      }
      implementation_->authorized_fingerprints.insert(fingerprint);
      session.phase = 4;
      return pairing_xml(true);
    }

    if (phrase_iterator != query.end() && phrase_iterator->second == "pairchallenge" && session.phase == 4) {
      return pairing_xml(true);
    }
    return pairing_xml(false, {}, {}, "Unexpected pairing phase");
  }

  std::string PairingManager::host_certificate_pem() const {
    return implementation_->host_certificate_pem;
  }

  std::string PairingManager::host_private_key_pem() const {
    return implementation_->host_private_key_pem;
  }

  bool PairingManager::is_authorized_client(std::string_view certificate_pem) const {
    auto certificate = parse_certificate(certificate_pem);
    if (!certificate) {
      return false;
    }
    const auto fingerprint = certificate_fingerprint(certificate.get());
    std::lock_guard lock(implementation_->mutex);
    return implementation_->authorized_fingerprints.contains(fingerprint);
  }

  std::size_t PairingManager::authorized_client_count() const {
    std::lock_guard lock(implementation_->mutex);
    return implementation_->authorized_fingerprints.size();
  }

  std::vector<std::string> PairingManager::authorized_clients() const {
    std::lock_guard lock(implementation_->mutex);
    return {implementation_->authorized_fingerprints.begin(), implementation_->authorized_fingerprints.end()};
  }

  Status PairingManager::remove_client(std::string_view fingerprint) {
    if (fingerprint.size() != 64 || !std::all_of(fingerprint.begin(), fingerprint.end(), [](char c) {
          return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
        })) {
      return Status::failure("Invalid certificate fingerprint");
    }
    std::lock_guard lock(implementation_->mutex);
    const std::string identity(fingerprint);
    if (!implementation_->authorized_fingerprints.contains(identity)) {
      return Status::failure("Client not found");
    }
    std::error_code error;
    for (const auto &entry : std::filesystem::directory_iterator(implementation_->state_directory / "clients", error)) {
      if (!entry.is_regular_file()) {
        continue;
      }
      const auto bytes = read_file(entry.path());
      const std::string pem(bytes.begin(), bytes.end());
      auto certificate = parse_certificate(pem);
      if (certificate && certificate_fingerprint(certificate.get()) == identity) {
        std::filesystem::remove(entry.path(), error);
        if (error) {
          return Status::failure(error.message());
        }
      }
    }
    if (error) {
      return Status::failure(error.message());
    }
    implementation_->authorized_fingerprints.erase(identity);
    return Status::success();
  }

}  // namespace senaistream
