#include "senaistream/moonlight_video_packetizer.hpp"

#include <gtest/gtest.h>

#include <cstdint>
#include <vector>

namespace {

  /**
   * @brief Reads a little-endian 32-bit integer from a test packet.
   *
   * @param source Four-byte input location.
   * @return Decoded integer.
   */
  std::uint32_t read_little_u32(const std::uint8_t *source) {
    return source[0] | (static_cast<std::uint32_t>(source[1]) << 8) |
           (static_cast<std::uint32_t>(source[2]) << 16) | (static_cast<std::uint32_t>(source[3]) << 24);
  }

  TEST(MoonlightVideoPacketizer, RejectsInvalidPayloadSizes) {
    senaistream::VideoPacketizerState state;
    const std::vector<std::uint8_t> frame {0, 0, 0, 1, 0x65};
    EXPECT_TRUE(senaistream::packetize_h264_frame(frame, true, 0, 24, state).empty());
    EXPECT_TRUE(senaistream::packetize_h264_frame({}, true, 0, 1392, state).empty());
  }

  TEST(MoonlightVideoPacketizer, ProducesReassemblableZeroFecFrame) {
    std::vector<std::uint8_t> frame(2500, 0xAB);
    frame[0] = 0;
    frame[1] = 0;
    frame[2] = 0;
    frame[3] = 1;
    frame[4] = 0x65;
    senaistream::VideoPacketizerState state;
    const auto packets = senaistream::packetize_h264_frame(frame, true, 90'000, 1000, state);
    ASSERT_EQ(packets.size(), 3U);
    EXPECT_EQ(packets.front()[0], 0x90);
    EXPECT_EQ(packets.front()[1], 96);
    EXPECT_EQ(packets.front()[24], 0x04);
    EXPECT_EQ(packets.back()[24], 0x03);
    EXPECT_EQ(read_little_u32(packets.front().data() + 28) >> 22, 3U);
    EXPECT_EQ((read_little_u32(packets[1].data() + 28) >> 12) & 0x3FFU, 1U);
    EXPECT_EQ(state.sequence_number, 3U);
    EXPECT_EQ(state.stream_packet_index, 3U);
    EXPECT_EQ(state.frame_index, 2U);

    std::vector<std::uint8_t> reconstructed;
    for (const auto &packet : packets) {
      reconstructed.insert(reconstructed.end(), packet.begin() + 32, packet.end());
    }
    ASSERT_GE(reconstructed.size(), 8U);
    EXPECT_EQ(reconstructed[0], 0x01);
    EXPECT_EQ(reconstructed[3], 0x02);
    reconstructed.erase(reconstructed.begin(), reconstructed.begin() + 8);
    EXPECT_EQ(reconstructed, frame);
  }

}  // namespace
