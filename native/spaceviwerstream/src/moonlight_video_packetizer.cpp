#include "senaistream/moonlight_video_packetizer.hpp"

#include <algorithm>
#include <cstring>
#include <limits>

namespace {

  constexpr std::size_t rtp_header_size = 12;
  constexpr std::size_t rtp_extension_size = 4;
  constexpr std::size_t video_header_size = 16;
  constexpr std::size_t frame_header_size = 8;

  /**
   * @brief Writes a little-endian 32-bit integer.
   *
   * @param destination Four-byte output location.
   * @param value Integer to encode.
   */
  void write_little_u32(std::uint8_t *destination, std::uint32_t value) noexcept {
    destination[0] = static_cast<std::uint8_t>(value);
    destination[1] = static_cast<std::uint8_t>(value >> 8);
    destination[2] = static_cast<std::uint8_t>(value >> 16);
    destination[3] = static_cast<std::uint8_t>(value >> 24);
  }

  /**
   * @brief Writes a network-byte-order 16-bit integer.
   *
   * @param destination Two-byte output location.
   * @param value Integer to encode.
   */
  void write_big_u16(std::uint8_t *destination, std::uint16_t value) noexcept {
    destination[0] = static_cast<std::uint8_t>(value >> 8);
    destination[1] = static_cast<std::uint8_t>(value);
  }

  /**
   * @brief Writes a network-byte-order 32-bit integer.
   *
   * @param destination Four-byte output location.
   * @param value Integer to encode.
   */
  void write_big_u32(std::uint8_t *destination, std::uint32_t value) noexcept {
    destination[0] = static_cast<std::uint8_t>(value >> 24);
    destination[1] = static_cast<std::uint8_t>(value >> 16);
    destination[2] = static_cast<std::uint8_t>(value >> 8);
    destination[3] = static_cast<std::uint8_t>(value);
  }

}  // namespace

namespace senaistream {

  std::vector<std::vector<std::uint8_t>> packetize_h264_frame(
    std::span<const std::uint8_t> annex_b,
    bool key_frame,
    std::uint32_t timestamp_90khz,
    std::size_t packet_payload_size,
    VideoPacketizerState &state) {
    if (annex_b.empty() || annex_b.size() > std::numeric_limits<std::size_t>::max() - frame_header_size ||
        packet_payload_size <= video_header_size + frame_header_size) {
      return {};
    }
    const auto media_capacity = packet_payload_size - video_header_size;
    const auto framed_size = frame_header_size + annex_b.size();
    const auto packet_count = (framed_size + media_capacity - 1) / media_capacity;
    if (packet_count == 0 || packet_count > 1023) {
      return {};
    }

    std::vector<std::uint8_t> framed(framed_size);
    framed[0] = 0x01;
    framed[3] = key_frame ? 0x02 : 0x01;
    std::memcpy(framed.data() + frame_header_size, annex_b.data(), annex_b.size());

    std::vector<std::vector<std::uint8_t>> datagrams;
    datagrams.reserve(packet_count);
    std::size_t source_offset = 0;
    for (std::size_t packet_index = 0; packet_index < packet_count; ++packet_index) {
      const auto chunk_size = std::min(media_capacity, framed.size() - source_offset);
      std::vector<std::uint8_t> packet(rtp_header_size + rtp_extension_size + video_header_size + chunk_size);
      packet[0] = 0x90;
      packet[1] = 96;
      write_big_u16(packet.data() + 2, state.sequence_number++);
      write_big_u32(packet.data() + 4, timestamp_90khz);
      write_big_u32(packet.data() + 8, 0);
      packet[12] = 0xBE;
      packet[13] = 0xDE;

      auto *video = packet.data() + rtp_header_size + rtp_extension_size;
      write_little_u32(video, (state.stream_packet_index++ & 0x00FFFFFFU) << 8);
      write_little_u32(video + 4, state.frame_index);
      const bool first = packet_index == 0;
      const bool last = packet_index + 1 == packet_count;
      video[8] = static_cast<std::uint8_t>((first ? 0x04 : 0x01) | (last ? 0x02 : 0x00));
      video[9] = 0;
      video[10] = 0x10;
      video[11] = 0;
      const auto fec_description = (static_cast<std::uint32_t>(packet_count) << 22) |
                                   (static_cast<std::uint32_t>(packet_index) << 12);
      write_little_u32(video + 12, fec_description);
      std::memcpy(video + video_header_size, framed.data() + source_offset, chunk_size);
      source_offset += chunk_size;
      datagrams.push_back(std::move(packet));
    }
    ++state.frame_index;
    return datagrams;
  }

}  // namespace senaistream
