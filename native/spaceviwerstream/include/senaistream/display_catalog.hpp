#pragma once

#include "senaistream/video_types.hpp"

#include <string>
#include <vector>

namespace senaistream {

  /**
   * @brief Enumerates desktop outputs using DXGI.
   */
  class DisplayCatalog {
  public:
    /**
     * @brief Enumerates active desktop outputs.
     *
     * @param error Receives a human-readable failure description.
     * @return Active outputs. An empty result with an empty error means that no output is active.
     */
    [[nodiscard]] std::vector<DisplayInfo> enumerate(std::string &error) const;
  };

}  // namespace senaistream

