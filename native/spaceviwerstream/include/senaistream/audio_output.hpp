#pragma once
#include "senaistream/status.hpp"
#include <memory>
#include <string>

namespace senaistream {
  /** @brief Temporarily redirects playback to a silent virtual output and restores it afterwards. */
  class AudioOutput {
  public:
    /** @brief Initializes COM and recovers a saved output after an interrupted host. */
    AudioOutput();
    /** @brief Restores original playback roles. */
    ~AudioOutput();
    /** @brief Enables or restores the virtual output. @param enabled Whether application audio is streaming. @return Result. */
    Status update(bool enabled);
    /** @brief Finds whether the signed virtual output is installed. @return Device availability. */
    bool available() const;
    /** @brief Returns whether the output is currently redirected. @return Active state. */
    bool active() const;
    /** @brief Gets the virtual cable's recording endpoint carrying redirected playback. @return Capture endpoint ID. */
    std::wstring endpoint() const;

  private:
    struct Implementation;
    std::unique_ptr<Implementation> implementation_;  ///< Windows state, used from the host loop only.
  };
}  // namespace senaistream
