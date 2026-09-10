#pragma once

#include "senaistream/pairing.hpp"
#include "senaistream/settings.hpp"
#include "senaistream/status.hpp"

#include <atomic>
#include <cstdint>
#include <string>
#include <string_view>

namespace senaistream {

  /**
   * @brief Describes the identity and ports advertised to GameStream clients.
   */
  struct HostIdentity {
    std::string hostname;  ///< Friendly host name shown by clients.
    std::string unique_id;  ///< Stable host identifier.
    std::string local_address {"127.0.0.1"};  ///< Address advertised to the requesting client.
    std::uint16_t http_port {47989};  ///< Plain discovery and pairing port.
    std::uint16_t https_port {47984};  ///< Authenticated control port.
  };

  /**
   * @brief Builds the public GameStream server-information document.
   *
   * @param identity Host identity and ports.
   * @param paired Whether the requesting client is paired.
   * @param busy Whether a streaming session is active.
   * @return UTF-8 XML response body.
   */
  [[nodiscard]] std::string build_server_info_xml(const HostIdentity &identity, bool paired, bool busy);

  /**
   * @brief Builds a complete RTSP response for a Moonlight negotiation request.
   *
   * @param request Complete RTSP request including its CSeq header.
   * @param base_port Base HTTP port; custom values isolate integration tests.
   * @return RTSP response that must be followed by closing the TCP connection.
   */
  [[nodiscard]] std::string build_rtsp_response(std::string_view request, std::uint16_t base_port = 47989);

  /**
   * @brief Identifies Moonlight's UDP connectivity-test datagram.
   *
   * @param datagram Received UDP payload.
   * @return True when the datagram is a Moonlight connectivity probe.
   */
  [[nodiscard]] bool is_connectivity_probe(std::string_view datagram) noexcept;

  /**
   * @brief Serves the GameStream discovery and control endpoints.
   */
  class GameStreamHost {
  public:
    /**
     * @brief Initializes a host with a stable identity.
     *
     * @param identity Host identity and listening ports.
     */
    explicit GameStreamHost(HostIdentity identity);

    /**
     * @brief Runs the HTTP discovery listener until a stop is requested.
     *
     * @return Listener status.
     */
    [[nodiscard]] Status run();

    /**
     * @brief Requests that a running listener stop.
     */
    void request_stop() noexcept;

  private:
    HostIdentity identity_;  ///< Identity returned to clients.
    PairingManager pairing_;  ///< PIN and certificate pairing state machine.
    SettingsStore settings_;  ///< Persistent management-panel settings.
    std::atomic_bool stop_requested_ {};  ///< Cooperative listener stop flag.
  };

  /**
   * @brief Creates a deterministic default identity for the current Windows host.
   *
   * @return Default host identity.
   */
  [[nodiscard]] HostIdentity default_host_identity();

}  // namespace senaistream
