#pragma once

#include "senaistream/status.hpp"

#include <cstddef>
#include <filesystem>
#include <functional>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

namespace senaistream {

  /**
   * @brief Implements the host side of the GameStream PIN pairing exchange.
   */
  class PairingManager {
  public:
    /**
     * @brief Constructs an uninitialized pairing manager.
     */
    PairingManager();

    /**
     * @brief Releases cryptographic resources.
     */
    ~PairingManager();

    PairingManager(const PairingManager &) = delete;
    PairingManager &operator=(const PairingManager &) = delete;

    /**
     * @brief Creates the ephemeral host identity used by the current prototype.
     *
     * @return Initialization status.
     */
    [[nodiscard]] Status initialize(const std::filesystem::path &state_directory = {});

    /**
     * @brief Handles one `/pair` request target.
     *
     * @param request_target Absolute-path request target including its query string.
     * @param pin_provider Callback invoked when the client requests the host certificate.
     * @return GameStream XML response body.
     */
    [[nodiscard]] std::string handle_request(
      std::string_view request_target,
      const std::function<std::string()> &pin_provider
    );

    /**
     * @brief Returns the host certificate in PEM representation.
     *
     * @return PEM certificate, or empty text before initialization.
     */
    [[nodiscard]] std::string host_certificate_pem() const;

    /**
     * @brief Returns the host private key in PEM representation.
     *
     * @return PEM private key, or empty text before initialization.
     */
    [[nodiscard]] std::string host_private_key_pem() const;

    /**
     * @brief Checks whether a presented client certificate completed pairing.
     *
     * @param certificate_pem Presented certificate in PEM representation.
     * @return True only for a persisted paired certificate.
     */
    [[nodiscard]] bool is_authorized_client(std::string_view certificate_pem) const;

    /**
     * @brief Returns the number of persisted paired client certificates.
     *
     * @return Paired-client count.
     */
    [[nodiscard]] std::size_t authorized_client_count() const;

    /** @brief Lists persisted certificate identities. @return Authorized SHA-256 fingerprints. */
    [[nodiscard]] std::vector<std::string> authorized_clients() const;

    /** @brief Revokes a persisted client from memory and disk.
     * @param fingerprint SHA-256 identity. @return Result of the revocation.
     */
    [[nodiscard]] Status remove_client(std::string_view fingerprint);

  private:
    class Implementation;
    std::unique_ptr<Implementation> implementation_;  ///< Hidden cryptographic implementation.
  };

}  // namespace senaistream
