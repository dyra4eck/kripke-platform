cmake_minimum_required(VERSION 3.16)
project(kripke_generator LANGUAGES CXX VERSION 0.1.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

find_package(nlohmann_json 3.11 QUIET)
if(NOT nlohmann_json_FOUND)
  include(FetchContent)
  FetchContent_Declare(nlohmann_json
    URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
    URL_HASH SHA256=d6c65aca6b1ed68e7a182f4757257b107ae403032760ed6ef121c9d55e81757d
  )
  FetchContent_MakeAvailable(nlohmann_json)
endif()

add_executable(kripke_generator src/kripke_generator.cpp)
target_link_libraries(kripke_generator PRIVATE nlohmann_json::nlohmann_json)
target_compile_options(kripke_generator PRIVATE -Wall -Wextra)

# Static link so the binary can be copied into a distroless/scratch layer.
option(STATIC_LINK "Link libstdc++ and libgcc statically" OFF)
if(STATIC_LINK)
  target_link_options(kripke_generator PRIVATE -static-libstdc++ -static-libgcc)
endif()

install(TARGETS kripke_generator RUNTIME DESTINATION bin)

include(CTest)
if(BUILD_TESTING)
  foreach(model K_GBN_fixed K_Karn_v2 K_RTO_v2)
    add_test(NAME golden_${model}
      COMMAND ${CMAKE_COMMAND}
        -DGEN=$<TARGET_FILE:kripke_generator>
        -DIN=${CMAKE_SOURCE_DIR}/examples/${model}.json
        -DGOLDEN=${CMAKE_SOURCE_DIR}/examples/${model}.smv
        -DOUT=${CMAKE_BINARY_DIR}/${model}.smv
        -P ${CMAKE_SOURCE_DIR}/cmake/golden_test.cmake)
  endforeach()
endif()
