#pragma once

#include <string>
#include <utility>

namespace senaistream {

  /**
   * @brief Represents the outcome of an operation that returns no value.
   */
  class Status {
  public:
    /**
     * @brief Creates a successful status.
     *
     * @return A successful status value.
     */
    static Status success() {
      return Status(true, {});
    }

    /**
     * @brief Creates a failed status.
     *
     * @param message Human-readable description of the failure.
     * @return A failed status value.
     */
    static Status failure(std::string message) {
      return Status(false, std::move(message));
    }

    /**
     * @brief Reports whether the operation succeeded.
     *
     * @return True for success; otherwise false.
     */
    [[nodiscard]] bool ok() const noexcept {
      return ok_;
    }

    /**
     * @brief Returns a human-readable failure description.
     *
     * @return Empty text for success or a failure description.
     */
    [[nodiscard]] const std::string &message() const noexcept {
      return message_;
    }

  private:
    /**
     * @brief Initializes a status value.
     *
     * @param ok Whether the represented operation succeeded.
     * @param message Human-readable failure description.
     */
    Status(bool ok, std::string message):
        ok_(ok),
        message_(std::move(message)) {
    }

    bool ok_;  ///< Whether the represented operation succeeded.
    std::string message_;  ///< Human-readable failure description.
  };

}  // namespace senaistream

