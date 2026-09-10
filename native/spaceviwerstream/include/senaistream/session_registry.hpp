#pragma once

#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace senaistream {
  inline constexpr std::size_t max_stream_clients = 4;  ///< Independent LAN client limit.

  /** @brief Owns independent sessions indexed by their LAN transport address. */
  template<class Session>
  class SessionRegistry {
  public:
    /** @brief Finds an authenticated launch. @param address LAN address. @return Session or null. */
    std::shared_ptr<Session> find(const std::string &address) const {
      std::scoped_lock lock(mutex_);
      const auto it = sessions_.find(address);
      return it == sessions_.end() ? nullptr : it->second;
    }

    /** @brief Reserves a client slot without overwriting another session.
     * @param address LAN address. @param session Fully initialized session. @return Whether reserved.
     */
    bool insert(const std::string &address, std::shared_ptr<Session> session) {
      std::scoped_lock lock(mutex_);
      if (sessions_.size() >= max_stream_clients || address.empty() || !session) {
        return false;
      }
      return sessions_.emplace(address, std::move(session)).second;
    }

    /** @brief Removes only the expected generation. @param address Address. @param expected Session to remove. */
    void erase(const std::string &address, const std::shared_ptr<Session> &expected) {
      std::scoped_lock lock(mutex_);
      const auto it = sessions_.find(address);
      if (it != sessions_.end() && it->second == expected) {
        sessions_.erase(it);
      }
    }

    /** @brief Copies stable session references for work outside the registry lock. @return Address/session pairs. */
    auto snapshot() const {
      std::scoped_lock lock(mutex_);
      return std::vector<std::pair<std::string, std::shared_ptr<Session>>>(sessions_.begin(), sessions_.end());
    }

  private:
    mutable std::mutex mutex_;  ///< Guards membership, not individual media producers.
    std::unordered_map<std::string, std::shared_ptr<Session>> sessions_;  ///< Authenticated LAN sessions.
  };
}  // namespace senaistream
