#include "senaistream/moonlight_audio_packetizer.hpp"

#include <gtest/gtest.h>

#include <array>
#include <cstdint>

TEST(MoonlightAudioPacketizer, ProducesNetworkOrderRtpPacket) {
  senaistream::AudioPacketizerState state;
  state.sequence = 0x1234;
  state.ssrc = 0x01020304;
  constexpr std::array<std::uint8_t, 3> opus {0xF8, 0xFF, 0xFE};

  const auto packet = senaistream::packetize_opus_frame(opus, 0x11223344, state);

  ASSERT_EQ(packet.size(), 15U);
  EXPECT_EQ(packet[0], 0x80);
  EXPECT_EQ(packet[1], 97);
  EXPECT_EQ(packet[2], 0x12);
  EXPECT_EQ(packet[3], 0x34);
  EXPECT_EQ(packet[4], 0x11);
  EXPECT_EQ(packet[5], 0x22);
  EXPECT_EQ(packet[6], 0x33);
  EXPECT_EQ(packet[7], 0x44);
  EXPECT_EQ(packet[8], 0x01);
  EXPECT_EQ(packet[11], 0x04);
  EXPECT_EQ(packet[12], 0xF8);
  EXPECT_EQ(state.sequence, 0x1235);
}
