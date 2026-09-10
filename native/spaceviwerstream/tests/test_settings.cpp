#include "senaistream/settings.hpp"

#include <gtest/gtest.h>

TEST(StreamSettings, AcceptsAutomaticAndManualModes) {
  senaistream::StreamSettings automatic;
  EXPECT_TRUE(senaistream::validate_stream_settings(automatic).empty());
  EXPECT_TRUE(automatic.prefer_virtual_display);

  automatic.width = 1920;
  automatic.height = 1080;
  automatic.frames_per_second = 120;
  automatic.bitrate_bps = 80'000'000;
  EXPECT_TRUE(senaistream::validate_stream_settings(automatic).empty());
}

TEST(StreamSettings, RejectsUnsafeRanges) {
  senaistream::StreamSettings settings;
  settings.width = 1920;
  EXPECT_FALSE(senaistream::validate_stream_settings(settings).empty());
  settings.height = 1079;
  EXPECT_FALSE(senaistream::validate_stream_settings(settings).empty());
  settings.height = 1080;
  settings.frames_per_second = 241;
  EXPECT_FALSE(senaistream::validate_stream_settings(settings).empty());
  settings.frames_per_second = 60;
  settings.bitrate_bps = 999'999;
  EXPECT_FALSE(senaistream::validate_stream_settings(settings).empty());
}
