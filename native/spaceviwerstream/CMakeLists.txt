cmake_minimum_required(VERSION 3.25)

project(SpaceViewerStream VERSION 2.2.12 LANGUAGES C CXX)

if(NOT WIN32)
  message(FATAL_ERROR "SenaiStream currently targets Windows only")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(SENAISTREAM_BUILD_TESTS "Build SenaiStream tests" ON)

include(FetchContent)
set(ENET_NO_INSTALL ON CACHE BOOL "" FORCE)
FetchContent_Declare(
  moonlight_enet
  SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/third_party/enet)
FetchContent_MakeAvailable(moonlight_enet)

find_package(PkgConfig REQUIRED)
pkg_check_modules(OPUS REQUIRED opus)
pkg_check_modules(OPENSSL REQUIRED openssl)
find_file(
  OPUS_STATIC_ARCHIVE
  NAMES libopus.a
  PATHS ${OPUS_LIBRARY_DIRS}
  NO_DEFAULT_PATH
  REQUIRED)
find_file(OPENSSL_CRYPTO_STATIC_ARCHIVE NAMES libcrypto.a PATHS ${OPENSSL_LIBRARY_DIRS} NO_DEFAULT_PATH REQUIRED)
find_file(OPENSSL_SSL_STATIC_ARCHIVE NAMES libssl.a PATHS ${OPENSSL_LIBRARY_DIRS} NO_DEFAULT_PATH REQUIRED)

add_library(senaistream_core
  src/audio_recorder.cpp
  src/audio_output.cpp
  src/display_catalog.cpp
  src/gamestream_host.cpp
  src/moonlight_audio_packetizer.cpp
  src/moonlight_video_packetizer.cpp
  src/pairing.cpp
  src/settings.cpp
  src/video_recorder.cpp)

target_include_directories(senaistream_core
  PUBLIC
    include
  PRIVATE
    ${OPUS_INCLUDE_DIRS}
    ${OPENSSL_INCLUDE_DIRS})
target_compile_definitions(senaistream_core PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_compile_options(senaistream_core PRIVATE -Wall -Wextra -Wpedantic)
target_link_libraries(senaistream_core
  PUBLIC
    d3d11
    dxgi
    mf
    mfplat
    mfreadwrite
    mfuuid
    mmdevapi
    ole32
    ${OPUS_STATIC_ARCHIVE}
    ${OPENSSL_SSL_STATIC_ARCHIVE}
    ${OPENSSL_CRYPTO_STATIC_ARCHIVE}
    enet
    bcrypt
    crypt32
    iphlpapi
    m
    ws2_32)

add_executable(SenaiStream src/main.cpp)
target_compile_definitions(SenaiStream PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_link_libraries(SenaiStream PRIVATE senaistream_core shell32)
if(MINGW)
  target_link_options(SenaiStream PRIVATE -static -static-libgcc -static-libstdc++)
endif()

add_executable(SenaiStreamTray WIN32 src/tray_main.cpp)
target_compile_definitions(SenaiStreamTray PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_compile_options(SenaiStreamTray PRIVATE -Wall -Wextra -Wpedantic)
target_link_libraries(SenaiStreamTray PRIVATE senaistream_core shell32)

add_executable(SenaiStreamUI WIN32 src/ui_main.cpp)
target_include_directories(SenaiStreamUI SYSTEM PRIVATE third_party/webview2/package/build/native/include)
target_compile_definitions(SenaiStreamUI PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_compile_options(SenaiStreamUI PRIVATE -Wall -Wextra -Wpedantic)
target_link_libraries(SenaiStreamUI PRIVATE dwmapi ole32 shell32 user32)
add_custom_command(
  TARGET SenaiStreamUI
  POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
          ${CMAKE_CURRENT_SOURCE_DIR}/third_party/webview2/package/runtimes/win-x64/native/WebView2Loader.dll
          $<TARGET_FILE_DIR:SenaiStreamUI>/WebView2Loader.dll)

add_executable(SenaiStreamService WIN32 src/service_main.cpp)
target_compile_definitions(SenaiStreamService PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_compile_options(SenaiStreamService PRIVATE -Wall -Wextra -Wpedantic)
target_link_libraries(SenaiStreamService PRIVATE advapi32 userenv wtsapi32)

add_executable(SenaiStreamDisplayCtl src/display_device_main.cpp)
target_compile_definitions(SenaiStreamDisplayCtl PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_compile_options(SenaiStreamDisplayCtl PRIVATE -Wall -Wextra -Wpedantic)
target_link_libraries(SenaiStreamDisplayCtl PRIVATE newdev setupapi user32)
if(MINGW)
  target_link_options(SenaiStreamTray PRIVATE -municode -static -static-libgcc -static-libstdc++)
  target_link_options(SenaiStreamUI PRIVATE -municode -static -static-libgcc -static-libstdc++)
  target_link_options(SenaiStreamService PRIVATE -municode -static -static-libgcc -static-libstdc++)
  target_link_options(SenaiStreamDisplayCtl PRIVATE -municode -static -static-libgcc -static-libstdc++)
endif()

install(TARGETS SenaiStream SenaiStreamTray SenaiStreamUI SenaiStreamService SenaiStreamDisplayCtl RUNTIME DESTINATION .)
install(FILES third_party/webview2/package/runtimes/win-x64/native/WebView2Loader.dll DESTINATION .)
install(FILES README.md ARCHITECTURE.md ARCHITECTURE_NOTES.md THIRD_PARTY_NOTICES.md DESTINATION docs)

if(SENAISTREAM_BUILD_TESTS)
  include(CTest)
  set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
  FetchContent_Declare(
    googletest
    SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/third_party/googletest)
  FetchContent_MakeAvailable(googletest)
  add_subdirectory(tests)
endif()

# The Electron interface owns the UI and lifecycle; package only these native tools.
set_target_properties(SenaiStream PROPERTIES OUTPUT_NAME SpaceviwerStream)
set_target_properties(SenaiStreamDisplayCtl PROPERTIES OUTPUT_NAME SpaceviwerStreamDisplayCtl)
