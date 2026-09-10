#include "management_page.hpp"

#include <gtest/gtest.h>

#include <string_view>

TEST(ManagementPage, ContainsNativeConsoleNavigationAndControls) {
  const std::string_view page = senaistream::ui::management_page;
  EXPECT_NE(page.find("SenaiStream"), std::string_view::npos);
  EXPECT_NE(page.find("data-page=\"overview\""), std::string_view::npos);
  EXPECT_NE(page.find("data-page=\"stream\""), std::string_view::npos);
  EXPECT_NE(page.find("data-page=\"display\""), std::string_view::npos);
  EXPECT_NE(page.find("class=\"dock\""), std::string_view::npos);
  EXPECT_NE(page.find("Estender"), std::string_view::npos);
  EXPECT_NE(page.find("Duplicar"), std::string_view::npos);
  EXPECT_NE(page.find("name=\"bitrateMbps\""), std::string_view::npos);
  EXPECT_NE(page.find("name=\"virtualDisplay\""), std::string_view::npos);
}

TEST(ManagementPage, UsesOnlyLoopbackApiPaths) {
  const std::string_view page = senaistream::ui::management_page;
  EXPECT_NE(page.find("fetch('/api/settings')"), std::string_view::npos);
  EXPECT_NE(page.find("fetch('/api/status')"), std::string_view::npos);
  EXPECT_NE(page.find("fetch('/api/pin'"), std::string_view::npos);
  EXPECT_NE(page.find("fetch('/api/display-mode'"), std::string_view::npos);
  EXPECT_EQ(page.find("<script src="), std::string_view::npos);
  EXPECT_EQ(page.find("<link rel=\"stylesheet\""), std::string_view::npos);
}
