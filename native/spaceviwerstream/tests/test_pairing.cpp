#include "senaistream/pairing.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <gtest/gtest.h>
#include <string>

namespace {

  /**
   * @brief Owns an isolated temporary directory for a pairing-state test.
   */
  class TemporaryStateDirectory {
  public:
    /**
     * @brief Creates a unique temporary directory.
     */
    TemporaryStateDirectory() {
      const auto suffix = std::chrono::steady_clock::now().time_since_epoch().count();
      path_ = std::filesystem::temp_directory_path() / ("senaistream-pairing-test-" + std::to_string(suffix));
      std::filesystem::create_directories(path_);
    }

    /**
     * @brief Removes the isolated test directory.
     */
    ~TemporaryStateDirectory() {
      std::error_code ignored;
      std::filesystem::remove_all(path_, ignored);
    }

    TemporaryStateDirectory(const TemporaryStateDirectory &) = delete;
    TemporaryStateDirectory &operator=(const TemporaryStateDirectory &) = delete;

    /**
     * @brief Returns the temporary directory path.
     *
     * @return Temporary directory path.
     */
    [[nodiscard]] const std::filesystem::path &path() const noexcept {
      return path_;
    }

  private:
    std::filesystem::path path_;  ///< Owned temporary directory.
  };

  TEST(PairingManager, PersistsStableProtectedHostIdentity) {
    TemporaryStateDirectory state;
    senaistream::PairingManager first;
    ASSERT_TRUE(first.initialize(state.path()).ok());
    const auto first_certificate = first.host_certificate_pem();
    const auto first_key = first.host_private_key_pem();
    EXPECT_FALSE(first_certificate.empty());
    EXPECT_FALSE(first_key.empty());

    senaistream::PairingManager second;
    ASSERT_TRUE(second.initialize(state.path()).ok());
    EXPECT_EQ(second.host_certificate_pem(), first_certificate);
    EXPECT_EQ(second.host_private_key_pem(), first_key);

    std::ifstream protected_stream(state.path() / "host-private-key.dpapi", std::ios::binary);
    const std::string protected_bytes {
      std::istreambuf_iterator<char>(protected_stream),
      std::istreambuf_iterator<char>()
    };
    EXPECT_FALSE(protected_bytes.empty());
    EXPECT_EQ(protected_bytes.find("PRIVATE KEY"), std::string::npos);
  }

  TEST(PairingManager, RejectsUnknownClientCertificate) {
    TemporaryStateDirectory state;
    senaistream::PairingManager manager;
    ASSERT_TRUE(manager.initialize(state.path()).ok());
    EXPECT_FALSE(manager.is_authorized_client(manager.host_certificate_pem()));
    EXPECT_FALSE(manager.is_authorized_client("not a certificate"));
  }

  TEST(PairingManager, RevocationRemovesAllPersistedCertificateAliases) {
    TemporaryStateDirectory state;
    senaistream::PairingManager identity;
    ASSERT_TRUE(identity.initialize(state.path()).ok());
    const auto certificate = identity.host_certificate_pem();
    std::filesystem::create_directories(state.path() / "clients");
    std::ofstream(state.path() / "clients" / "old-name.pem") << certificate;
    std::ofstream(state.path() / "clients" / "another-name.pem") << certificate;
    senaistream::PairingManager manager;
    ASSERT_TRUE(manager.initialize(state.path()).ok());
    ASSERT_EQ(manager.authorized_clients().size(), 1u);
    EXPECT_FALSE(manager.remove_client("../../host-certificate").ok());
    ASSERT_TRUE(manager.remove_client(manager.authorized_clients().front()).ok());
    EXPECT_FALSE(manager.is_authorized_client(certificate));
    senaistream::PairingManager reloaded;
    ASSERT_TRUE(reloaded.initialize(state.path()).ok());
    EXPECT_FALSE(reloaded.is_authorized_client(certificate));
  }

}  // namespace
