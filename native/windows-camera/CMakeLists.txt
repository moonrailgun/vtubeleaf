cmake_minimum_required(VERSION 3.21)
project(VTubeLeafCamera LANGUAGES CXX)
if(NOT WIN32)
  message(FATAL_ERROR "Use a Windows compiler/toolchain")
endif()
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
add_compile_definitions(UNICODE _UNICODE WIN32_LEAN_AND_MEAN _WIN32_WINNT=0x0A00)
add_library(dshow_base STATIC
  vendor/baseclasses/amfilter.cpp vendor/baseclasses/amvideo.cpp
  vendor/baseclasses/combase.cpp vendor/baseclasses/dllentry.cpp
  vendor/baseclasses/dllsetup.cpp vendor/baseclasses/mtype.cpp
  vendor/baseclasses/source.cpp vendor/baseclasses/winutil.cpp
  vendor/baseclasses/wxdebug.cpp vendor/baseclasses/wxlist.cpp vendor/baseclasses/wxutil.cpp)
target_include_directories(dshow_base PUBLIC vendor vendor/baseclasses)
target_link_libraries(dshow_base PUBLIC strmiids ole32 oleaut32 uuid winmm advapi32 user32 gdi32)
add_library(VTubeLeafCamera SHARED Filter.cpp Camera.def)
target_link_libraries(VTubeLeafCamera PRIVATE dshow_base)
add_library(VTubeLeafCameraHost STATIC Host.cpp)
target_link_libraries(VTubeLeafCameraHost PUBLIC advapi32)
include(CTest)
if(BUILD_TESTING)
  add_executable(camera_test tests/Camera.cpp)
  target_link_libraries(camera_test PRIVATE dshow_base VTubeLeafCameraHost)
  add_test(NAME camera COMMAND camera_test $<TARGET_FILE:VTubeLeafCamera>)
  set_tests_properties(camera PROPERTIES TIMEOUT 20)
endif()
