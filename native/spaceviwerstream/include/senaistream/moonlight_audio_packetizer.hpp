#pragma once

#include <cstdint>
#include <span>
#include <vector>

namespace senaistream {

  /**
   * @brief Mutable RTP sequence state for one Moonlight audio stream.
   */
  struct AudioPacketizerState {
    std::uint16_t sequence {};  ///< Next RTP sequence number.
    std::uint32_t ssrc {0x53534155};  ///< Stable synchronization-source identifier.
  };

  /**
   * @brief Wraps one Opus frame in the RTP layout consumed by Moonlight.
   *
   * @param opus Encoded Opus frame, optionally encrypted by the caller.
   * @param timestamp_ms GameStream RTP timestamp in milliseconds (not standard 48 kHz RTP units).
   * @param state Per-session sequence and source state.
   * @return Complete UDP datagram.
   */
  [[nodiscard]] std::vector<std::uint8_t> packetize_opus_frame(
    std::span<const std::uint8_t> opus,
    std::uint32_t timestamp_ms,
    AudioPacketizerState &state
  );

}  // namespace senaistream
