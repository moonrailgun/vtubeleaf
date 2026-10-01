cmake_minimum_required(VERSION 3.21)
project(VTubeLeafTexture LANGUAGES CXX)
if(NOT WIN32)
  message(FATAL_ERROR "Use a Windows compiler/toolchain")
endif()
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
add_library(VTubeLeafTexture STATIC
  Output.cpp
  vendor/Spout/SpoutCopy.cpp vendor/Spout/SpoutDirectX.cpp vendor/Spout/SpoutDX.cpp
  vendor/Spout/SpoutFrameCount.cpp vendor/Spout/SpoutSenderNames.cpp
  vendor/Spout/SpoutSharedMemory.cpp vendor/Spout/SpoutUtils.cpp)
target_include_directories(VTubeLeafTexture PRIVATE vendor/Spout)
target_link_libraries(VTubeLeafTexture PUBLIC
  d3d11 dxgi shell32 advapi32 version comctl32 winmm psapi user32 gdi32)
include(CTest)
if(BUILD_TESTING)
  add_executable(texture_test tests/Texture.cpp)
  target_include_directories(texture_test PRIVATE vendor/Spout)
  target_link_libraries(texture_test PRIVATE VTubeLeafTexture)
  add_test(NAME texture COMMAND texture_test)
  set_tests_properties(texture PROPERTIES TIMEOUT 20)
endif()
