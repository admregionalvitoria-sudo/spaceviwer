#include "senaistream/gamestream_host.hpp"

#include <gtest/gtest.h>

#include <string>

namespace {

  TEST(GameStreamHost, BuildsDiscoverableServerInfo) {
    const senaistream::HostIdentity identity {"SenaiStream & Test", "abc123", "192.0.2.10", 47989, 47984};
    const auto xml = senaistream::build_server_info_xml(identity, false, false);
    EXPECT_NE(xml.find("<hostname>SenaiStream &amp; Test</hostname>"), std::string::npos);
    EXPECT_NE(xml.find("<uniqueid>abc123</uniqueid>"), std::string::npos);
    EXPECT_NE(xml.find("<HttpsPort>47984</HttpsPort>"), std::string::npos);
    EXPECT_NE(xml.find("<ServerCodecModeSupport>1</ServerCodecModeSupport>"), std::string::npos);
    EXPECT_NE(xml.find("<MaxLumaPixelsHEVC>0</MaxLumaPixelsHEVC>"), std::string::npos);
    EXPECT_NE(xml.find("<PairStatus>0</PairStatus>"), std::string::npos);
    EXPECT_NE(xml.find("MJOLNIR_STATE_SERVER_AVAILABLE"), std::string::npos);
  }

  TEST(GameStreamHost, ReportsPairedBusyState) {
    const senaistream::HostIdentity identity {"SenaiStream", "abc123"};
    const auto xml = senaistream::build_server_info_xml(identity, true, true);
    EXPECT_NE(xml.find("<PairStatus>1</PairStatus>"), std::string::npos);
    EXPECT_NE(xml.find("<currentgame>1</currentgame>"), std::string::npos);
    EXPECT_NE(xml.find("MJOLNIR_STATE_SERVER_BUSY"), std::string::npos);
  }

  TEST(GameStreamHost, BuildsRtspOptionsWithMatchingSequence) {
    const auto response = senaistream::build_rtsp_response("OPTIONS rtsp://127.0.0.1:48010 RTSP/1.0\r\nCSeq: 41\r\n\r\n");
    EXPECT_TRUE(response.starts_with("RTSP/1.0 200 OK\r\nCSeq: 41\r\n"));
    EXPECT_NE(response.find("Public: OPTIONS, DESCRIBE, SETUP"), std::string::npos);
  }

  TEST(GameStreamHost, DescribesH264AndStereoOpusStreams) {
    const auto response = senaistream::build_rtsp_response("DESCRIBE / RTSP/1.0\r\nCSeq: 2\r\n\r\n");
    EXPECT_NE(response.find("Content-Type: application/sdp"), std::string::npos);
    EXPECT_NE(response.find("H264/90000"), std::string::npos);
    EXPECT_NE(response.find("opus/48000/2"), std::string::npos);
  }

  TEST(GameStreamHost, AdvertisesPerStreamUdpPorts) {
    const auto audio = senaistream::build_rtsp_response("SETUP streamid=audio/0/0 RTSP/1.0\r\nCSeq: 3\r\n\r\n");
    const auto video = senaistream::build_rtsp_response("SETUP streamid=video/0/0 RTSP/1.0\r\nCSeq: 4\r\n\r\n");
    EXPECT_NE(audio.find("server_port=48000-48001"), std::string::npos);
    EXPECT_NE(video.find("server_port=47998-47999"), std::string::npos);
    EXPECT_NE(audio.find("Session: 1"), std::string::npos);
  }

  TEST(GameStreamHost, RecognizesOnlyMoonlightConnectivityDatagrams) {
    EXPECT_TRUE(senaistream::is_connectivity_probe(std::string_view {"moonlight-ctest\0padding", 23}));
    EXPECT_FALSE(senaistream::is_connectivity_probe("moonlight"));
    EXPECT_FALSE(senaistream::is_connectivity_probe("Moonlight-ctest"));
  }

}  // namespace
