#include "senaistream/session_registry.hpp"

#include <atomic>
#include <gtest/gtest.h>
#include <thread>

namespace {
  /** @brief Small session stand-in used to verify isolation and admission. */
  struct Session {
    int key;
  };  ///< Distinct simulated encryption identity.
}  // namespace

TEST(SessionRegistry, KeepsTwoClientsAndTheirKeysIndependent) {
  senaistream::SessionRegistry<Session> registry;
  auto first = std::make_shared<Session>(Session {11});
  auto second = std::make_shared<Session>(Session {22});
  ASSERT_TRUE(registry.insert("192.168.1.10", first));
  ASSERT_TRUE(registry.insert("192.168.1.11", second));
  EXPECT_EQ(registry.find("192.168.1.10")->key, 11);
  EXPECT_EQ(registry.find("192.168.1.11")->key, 22);
  registry.erase("192.168.1.10", first);
  EXPECT_EQ(registry.find("192.168.1.11"), second);
  EXPECT_FALSE(registry.find("192.168.1.10"));
}

TEST(SessionRegistry, NeverOverwritesActiveSessionOrErasesAnotherGeneration) {
  senaistream::SessionRegistry<Session> registry;
  auto first = std::make_shared<Session>(Session {11});
  auto stale = std::make_shared<Session>(Session {22});
  ASSERT_TRUE(registry.insert("tv", first));
  EXPECT_FALSE(registry.insert("tv", stale));
  registry.erase("tv", stale);
  EXPECT_EQ(registry.find("tv"), first);
  EXPECT_FALSE(registry.insert("", first));
  EXPECT_FALSE(registry.insert("none", nullptr));
}

TEST(SessionRegistry, EnforcesCapacityAtomicallyAndReusesDisconnectedSlot) {
  senaistream::SessionRegistry<Session> registry;
  std::atomic_int accepted {};
  std::vector<std::thread> workers;
  for (int i = 0; i < 12; ++i) {
    workers.emplace_back([&, i] {
      if (registry.insert(std::to_string(i), std::make_shared<Session>(Session {i}))) {
        ++accepted;
      }
    });
  }
  for (auto &worker : workers) {
    worker.join();
  }
  EXPECT_EQ(accepted, senaistream::max_stream_clients);
  auto entries = registry.snapshot();
  EXPECT_EQ(entries.size(), senaistream::max_stream_clients);
  registry.erase(entries.front().first, entries.front().second);
  EXPECT_TRUE(registry.insert("new", std::make_shared<Session>(Session {99})));
}
