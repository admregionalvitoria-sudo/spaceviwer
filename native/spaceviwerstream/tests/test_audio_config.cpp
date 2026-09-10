#include "senaistream/audio_recorder.hpp"

#include <gtest/gtest.h>

namespace {

  TEST(AudioConfig, AcceptsDefaults) {
    EXPECT_TRUE(senaistream::validate_audio_config({}).empty());
  }

  TEST(AudioConfig, RejectsInvalidDuration) {
    senaistream::AudioRecordConfig config;
    config.duration_seconds = 0;
    EXPECT_FALSE(senaistream::validate_audio_config(config).empty());
    config.duration_seconds = 86'401;
    EXPECT_FALSE(senaistream::validate_audio_config(config).empty());
  }

  TEST(AudioConfig, RejectsInvalidBitrate) {
    senaistream::AudioRecordConfig config;
    config.bitrate_bps = 15'999;
    EXPECT_FALSE(senaistream::validate_audio_config(config).empty());
    config.bitrate_bps = 512'001;
    EXPECT_FALSE(senaistream::validate_audio_config(config).empty());
  }

  TEST(AudioConfig, RejectsUnsupportedFrameDuration) {
    senaistream::AudioRecordConfig config;
    config.frame_duration_ms = 15;
    EXPECT_FALSE(senaistream::validate_audio_config(config).empty());
    config.frame_duration_ms = 5;
    EXPECT_TRUE(senaistream::validate_audio_config(config).empty());
    config.frame_duration_ms = 10;
    EXPECT_TRUE(senaistream::validate_audio_config(config).empty());
    config.frame_duration_ms = 20;
    EXPECT_TRUE(senaistream::validate_audio_config(config).empty());
  }

}  // namespace
