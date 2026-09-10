#pragma once
#include "senaistream/video_types.hpp"
#include <algorithm>
#include <map>
#include <mutex>
#include <optional>
#include <set>
#include <string>
#include <vector>

namespace senaistream {
  /** @brief A TV's independent video and process-audio selection. */
  struct SessionRoute {
    std::string display_key;  ///< Logical virtual slot or physical Windows name.
    std::uint32_t audio_pid {};  ///< Selected process tree; zero means silence.
    std::uint64_t audio_window {};  ///< Window identity used to detect process reuse.
    std::string audio_name;  ///< Selected application's window title.
  };

  /** @brief Assigns separate virtual monitors and retains choices across reconnects. */
  class SessionRoutes {
  public:
    /** @brief Gets a logical key stable across virtual adapter restarts.
     * @param displays Current catalog. @param index DXGI index. @return Logical key. */
    static std::string key(const std::vector<DisplayInfo> &displays, std::uint32_t index) {
      std::size_t slot = 0;
      for (const auto &display : displays) {
        if (display.index == index) {
          return display.virtual_display ? "virtual:" + std::to_string(slot) : "physical:" + display.device_name;
        }
        if (display.virtual_display) {
          ++slot;
        }
      }
      return {};
    }

    /** @brief Resolves a logical slot without ever falling back to the primary display.
     * @param route Selected route. @param displays Current catalog. @return Available display. */
    static std::optional<DisplayInfo> resolve(const SessionRoute &route, const std::vector<DisplayInfo> &displays) {
      for (const auto &display : displays) {
        if (key(displays, display.index) == route.display_key) {
          return display;
        }
      }
      return std::nullopt;
    }

    /** @brief Reserves an unused virtual screen for a new client.
     * @param address Client address. @param displays Current catalog. @param fallback Initial physical selection when no virtual screens exist. */
    void attach(const std::string &address, const std::vector<DisplayInfo> &displays, std::uint32_t fallback) {
      std::lock_guard lock(mutex_);
      if (!routes_.contains(address)) {
        std::set<std::string> used;
        for (const auto &client : active_) {
          used.insert(routes_.at(client).display_key);
        }
        SessionRoute route;
        std::size_t virtual_count = 0;
        for (const auto &display : displays) {
          if (display.virtual_display) {
            ++virtual_count;
            auto candidate = key(displays, display.index);
            if (route.display_key.empty() && !used.contains(candidate)) {
              route.display_key = candidate;
            }
          }
        }
        if (route.display_key.empty()) {
          route.display_key = virtual_count ? "virtual:" + std::to_string(virtual_count) : key(displays, fallback);
        }
        routes_[address] = route;
      }
      active_.insert(address);
    }

    /** @brief Releases a connection and stale process IDs while retaining its monitor choice. @param address Client address. */
    void detach(const std::string &address) {
      std::lock_guard lock(mutex_);
      active_.erase(address);
      if (routes_.contains(address)) {
        routes_[address].audio_pid = 0;
        routes_[address].audio_window = 0;
        routes_[address].audio_name.clear();
      }
    }

    /** @brief Reads a consistent route. @param address Client address. @return Route snapshot. */
    SessionRoute get(const std::string &address) const {
      std::lock_guard lock(mutex_);
      auto found = routes_.find(address);
      return found == routes_.end() ? SessionRoute {} : found->second;
    }

    /** @brief Updates only one TV's display and clears audio from the previous screen.
     * @param address Client. @param display_key Logical display identity. */
    void select(const std::string &address, const std::string &display_key) {
      std::lock_guard lock(mutex_);
      routes_[address] = SessionRoute {display_key, 0, 0, {}};
    }

    /** @brief Selects the process whose audio belongs to a TV.
     * @param address Client. @param pid Process ID. @param window Window handle. @param name Application label. */
    void audio(const std::string &address, std::uint32_t pid, std::uint64_t window, std::string name) {
      std::lock_guard lock(mutex_);
      auto &route = routes_[address];
      route.audio_pid = pid;
      route.audio_window = window;
      route.audio_name = std::move(name);
    }

  private:
    mutable std::mutex mutex_;  ///< Protects selection and reservation transactions.
    std::map<std::string, SessionRoute> routes_;  ///< Remembered connection choices.
    std::set<std::string> active_;  ///< Occupied virtual screens.
  };
}  // namespace senaistream
