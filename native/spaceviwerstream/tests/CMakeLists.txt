add_executable(
  test_sunshine
  test_live_sessions.cpp
  test_session_registry.cpp
  test_audio_config.cpp
  test_gamestream_host.cpp
  test_management_page.cpp
  test_moonlight_audio_packetizer.cpp
  test_moonlight_video_packetizer.cpp
  test_pairing.cpp
  test_settings.cpp
  test_video_config.cpp)
target_link_libraries(test_sunshine PRIVATE senaistream_core GTest::gtest_main)
target_include_directories(test_sunshine PRIVATE ../src)
if(MINGW)
  target_link_options(test_sunshine PRIVATE -static -static-libgcc -static-libstdc++)
endif()

include(GoogleTest)
gtest_discover_tests(test_sunshine)

