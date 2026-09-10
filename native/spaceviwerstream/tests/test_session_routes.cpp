#include "senaistream/session_routes.hpp"
#include <gtest/gtest.h>
using namespace senaistream;

namespace {
  /** @brief Creates a primary screen and two virtual screens with arbitrary DXGI indices. */
  std::vector<DisplayInfo> catalog() {
    return {{0, "PC", "DISPLAY1", 1920, 1080, true, false}, {2, "TV1", "DISPLAY8", 1920, 1080, false, true}, {3, "TV2", "DISPLAY9", 1920, 1080, false, true}};
  }

  TEST(SessionRoutes, AssignsSeparateVirtualScreensWithoutUsingPrimary) {
    SessionRoutes routes;
    auto screens = catalog();
    routes.attach("tv1", screens, 0);
    routes.attach("tv2", screens, 0);
    EXPECT_EQ(SessionRoutes::resolve(routes.get("tv1"), screens)->index, 2u);
    EXPECT_EQ(SessionRoutes::resolve(routes.get("tv2"), screens)->index, 3u);
    routes.attach("tv3", screens, 0);
    EXPECT_FALSE(SessionRoutes::resolve(routes.get("tv3"), screens));
  }

  TEST(SessionRoutes, VirtualSlotsSurviveRenumberingAndMissingScreensNeverExposeDesktop) {
    SessionRoutes routes;
    auto screens = catalog();
    routes.attach("tv1", screens, 0);
    screens[1].index = 7;
    screens[1].device_name = "DISPLAY20";
    EXPECT_EQ(SessionRoutes::resolve(routes.get("tv1"), screens)->index, 7u);
    screens.resize(1);
    EXPECT_FALSE(SessionRoutes::resolve(routes.get("tv1"), screens));
  }

  TEST(SessionRoutes, SelectionAndAudioAreIndependentAndReconnectClearsStalePid) {
    SessionRoutes routes;
    auto screens = catalog();
    routes.attach("tv1", screens, 0);
    routes.attach("tv2", screens, 0);
    routes.audio("tv1", 123, 456, "Player A");
    routes.audio("tv2", 789, 987, "Player B");
    EXPECT_EQ(routes.get("tv1").audio_pid, 123u);
    EXPECT_EQ(routes.get("tv2").audio_pid, 789u);
    routes.select("tv1", "virtual:1");
    EXPECT_EQ(routes.get("tv1").audio_pid, 0u);
    routes.detach("tv2");
    routes.attach("tv2", screens, 0);
    EXPECT_EQ(routes.get("tv2").display_key, "virtual:1");
    EXPECT_EQ(routes.get("tv2").audio_pid, 0u);
  }
}  // namespace
