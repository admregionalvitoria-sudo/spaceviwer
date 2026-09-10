#include "senaistream/moonlight_audio_packetizer.hpp"

#include <algorithm>
#include <cstddef>

namespace {

  /**
   * @brief Stores a 16-bit integer in network byte order.
   *
   * @param destination First destination byte.
   * @param value Value to store.
   */
  void store_be16(std::uint8_t *destination, std::uint16_t value) {
    destination[0] = static_cast<std::uint8_t>(value >> 8);
    destination[1] = static_cast<std::uint8_t>(value);
  }

  /**
   * @brief Stores a 32-bit integer in network byte order.
   *
   * @param destination First destination byte.
   * @param value Value to store.
   */
  void store_be32(std::uint8_t *destination, std::uint32_t value) {
    destination[0] = static_cast<std::uint8_t>(value >> 24);
    destination[1] = static_cast<std::uint8_t>(value >> 16);
    destination[2] = static_cast<std::uint8_t>(value >> 8);
    destination[3] = static_cast<std::uint8_t>(value);
  }

}  // namespace

namespace senaistream {

  std::vector<std::uint8_t> packetize_opus_frame(
    std::span<const std::uint8_t> opus,
    std::uint32_t timestamp_48khz,
    AudioPacketizerState &state) {
    constexpr std::size_t rtp_header_size = 12;
    std::vector<std::uint8_t> packet(rtp_header_size + opus.size());
    packet[0] = 0x80;
    packet[1] = 97;
    store_be16(packet.data() + 2, state.sequence++);
    store_be32(packet.data() + 4, timestamp_48khz);
    store_be32(packet.data() + 8, state.ssrc);
    std::copy(opus.begin(), opus.end(), packet.begin() + static_cast<std::ptrdiff_t>(rtp_header_size));
    return packet;
  }

}  // namespace senaistream
