#pragma once

#include <cstddef>
#include <cstdint>
#include <span>
#include <vector>

namespace senaistream {

  /**
   * @brief Mutable counters used while packetizing one Moonlight video stream.
   */
  struct VideoPacketizerState {
    std::uint16_t sequence_number {};  ///< RTP sequence number in host byte order.
    std::uint32_t stream_packet_index {};  ///< Monotonic 24-bit stream packet index.
    std::uint32_t frame_index {1};  ///< Monotonic frame number starting at one.
  };

  /**
   * @brief Splits one H.264 Annex-B access unit into Moonlight video datagrams.
   *
   * FEC is intentionally disabled in this first implementation. The generated
   * headers still describe a complete zero-parity FEC block so clients can
   * reconstruct frames without guessing packet counts.
   *
   * @param annex_b Complete H.264 access unit beginning with an Annex-B start code.
   * @param key_frame Whether the access unit is independently decodable.
   * @param timestamp_90khz Presentation timestamp on the RTP 90 kHz clock.
   * @param packet_payload_size Negotiated bytes after the RTP extension header.
   * @param state Counters updated after packetization.
   * @return Ordered UDP datagrams, or an empty vector for invalid input.
   */
  [[nodiscard]] std::vector<std::vector<std::uint8_t>> packetize_h264_frame(
    std::span<const std::uint8_t> annex_b,
    bool key_frame,
    std::uint32_t timestamp_90khz,
    std::size_t packet_payload_size,
    VideoPacketizerState &state);

}  // namespace senaistream
