#include "senaistream/video_types.hpp"

#include <gtest/gtest.h>

namespace {

  TEST(VideoConfig, AcceptsDefaults) {
    EXPECT_TRUE(senaistream::validate_video_config({}).empty());
  }

  TEST(VideoConfig, RejectsInvalidFrameRate) {
    senaistream::VideoRecordConfig config;
    config.frames_per_second = 0;
    EXPECT_FALSE(senaistream::validate_video_config(config).empty());
    config.frames_per_second = 241;
    EXPECT_FALSE(senaistream::validate_video_config(config).empty());
  }

  TEST(VideoConfig, RejectsInvalidBitrate) {
    senaistream::VideoRecordConfig config;
    config.bitrate_bps = 99'999;
    EXPECT_FALSE(senaistream::validate_video_config(config).empty());
    config.bitrate_bps = 200'000'001;
    EXPECT_FALSE(senaistream::validate_video_config(config).empty());
  }

  TEST(VideoConfig, RejectsMismatchedOrOddDimensions) {
    senaistream::VideoRecordConfig config;
    config.width = 1920;
    EXPECT_FALSE(senaistream::validate_video_config(config).empty());
    config.height = 1081;
    EXPECT_FALSE(senaistream::validate_video_config(config).empty());
    config.height = 1080;
    EXPECT_TRUE(senaistream::validate_video_config(config).empty());
  }

  TEST(VideoConfig, RejectsInvalidDuration) {
    senaistream::VideoRecordConfig config;
    config.duration_seconds = 0;
    EXPECT_FALSE(senaistream::validate_video_config(config).empty());
    config.duration_seconds = 86'401;
    EXPECT_FALSE(senaistream::validate_video_config(config).empty());
  }

}  // namespace

