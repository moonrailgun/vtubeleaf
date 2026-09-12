// Optional Windows bridge for NVIDIA AR SDK 1.1 FaceExpressions.
// SDK headers, models and DLLs are supplied by the user, not bundled with VTubeLeaf.
#include <Windows.h>
#include <array>
#include <chrono>
#include <cmath>
#include <iostream>
#include <locale>
#include <sstream>
#include <string>
#include <thread>
#include "nvAR.h"
#include "nvARFaceExpressions.h"
#include "nvAR_defs.h"
#include "nvCVOpenCV.h"

struct Failure { const char* stage; int code; };

static void check(NvCV_Status status, const char* stage) {
  if (status != NVCV_SUCCESS) throw Failure{stage, static_cast<int>(status)};
}

static std::string utf8(const wchar_t* text) {
  const int length = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, text, -1, nullptr, 0, nullptr, nullptr);
  if (length == 0) throw Failure{"Invalid model path", 0};
  std::string result(length, '\0');
  if (!WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, text, -1, result.data(), length, nullptr, nullptr))
    throw Failure{"Invalid model path", 0};
  result.pop_back();
  return result;
}

struct Feature {
  NvAR_FeatureHandle handle = nullptr;
  ~Feature() { if (handle) NvAR_Destroy(handle); }
};

int wmain(int argc, wchar_t** argv) {
  std::cout.imbue(std::locale::classic());
  // Only this child process uses the adjacent SDK runtime.
  SetEnvironmentVariableW(L"NV_AR_SDK_PATH", L"USE_APP_PATH");
  try {
    if (argc != 6) throw Failure{"Expected models camera fps width height", 0};
    const auto model_dir = utf8(argv[1]);
    const int camera = std::stoi(argv[2]), fps = std::stoi(argv[3]);
    const int width = std::stoi(argv[4]), height = std::stoi(argv[5]);
    if (camera < 0 || camera > 32 || (fps != 15 && fps != 24 && fps != 30 && fps != 60)
        || !((width == 640 && height == 360) || (width == 1280 && height == 720)
             || (width == 1920 && height == 1080)))
      throw Failure{"Invalid camera settings", 0};

    cv::VideoCapture capture(camera, cv::CAP_DSHOW);
    if (!capture.isOpened()) throw Failure{"Cannot open camera", 0};
    capture.set(cv::CAP_PROP_FRAME_WIDTH, width);
    capture.set(cv::CAP_PROP_FRAME_HEIGHT, height);
    capture.set(cv::CAP_PROP_FPS, fps);
    cv::Mat frame;
    if (!capture.read(frame) || frame.empty() || frame.type() != CV_8UC3)
      throw Failure{"Cannot read BGR camera frame", 0};

    NvCVImage gpu, cpu;
    check(NvCVImage_Alloc(&gpu, frame.cols, frame.rows, NVCV_BGR, NVCV_U8, NVCV_CHUNKY, NVCV_GPU, 1), "GPU image allocation");
    Feature feature;
    check(NvAR_Create(NvAR_Feature_FaceExpressions, &feature.handle), "Create FaceExpressions");
    const auto handle = feature.handle;
    check(NvAR_SetString(handle, NvAR_Parameter_Config(ModelDir), model_dir.c_str()), "Set model directory");
    check(NvAR_SetCudaStream(handle, NvAR_Parameter_Config(CUDAStream), nullptr), "Set CUDA stream");
    check(NvAR_SetU32(handle, NvAR_Parameter_Config(Temporal), 0x37), "Set temporal filter");
    check(NvAR_SetU32(handle, NvAR_Parameter_Config(PoseMode), 0), "Set rotational pose");
    // Older SDKs can still track the face without the experimental cheek coefficients.
    const auto cheek_status = NvAR_SetU32(handle, NvAR_Parameter_Config(EnableCheekPuff), 1);
    if (cheek_status != NVCV_SUCCESS)
      std::cerr << "Cheek puff unavailable: " << static_cast<int>(cheek_status) << '\n';
    check(NvAR_Load(handle), "Load FaceExpressions models");

    unsigned count = 0;
    check(NvAR_GetU32(handle, NvAR_Parameter_Config(ExpressionCount), &count), "Read expression count");
    if (count != 53) throw Failure{"Unsupported expression layout (requires 53)", static_cast<int>(count)};
    std::array<float, 53> expressions{};
    NvAR_Quaternion rotation{};
    std::array<NvAR_Rect, 25> rectangles{};
    NvAR_BBoxes boxes{rectangles.data(), 0, static_cast<uint8_t>(rectangles.size())};
    // Match the SDK FaceExpressions sample's required output buffers.
    std::array<NvAR_Point2f, 126> landmarks{};
    std::array<NvAR_Point3f, 126> landmarks3d{};
    std::array<float, 126> confidence{};
    NvAR_Vector3f translation{};
    std::array<float, 3> intrinsics{static_cast<float>(frame.rows), frame.cols / 2.f, frame.rows / 2.f};
    check(NvAR_SetObject(handle, NvAR_Parameter_Input(Image), &gpu, sizeof(gpu)), "Set input image");
    check(NvAR_SetObject(handle, NvAR_Parameter_Output(BoundingBoxes), &boxes, sizeof(boxes)), "Set bounding boxes");
    check(NvAR_SetObject(handle, NvAR_Parameter_Output(Landmarks), landmarks.data(), sizeof(NvAR_Point2f)), "Set landmarks");
    check(NvAR_SetObject(handle, NvAR_Parameter_Output(Landmarks3d), landmarks3d.data(), sizeof(NvAR_Point3f)), "Set 3D landmarks");
    check(NvAR_SetF32Array(handle, NvAR_Parameter_Output(LandmarksConfidence), confidence.data(), 126), "Set confidence");
    check(NvAR_SetF32Array(handle, NvAR_Parameter_Input(CameraIntrinsicParams), intrinsics.data(), 3), "Set camera intrinsics");
    check(NvAR_SetObject(handle, NvAR_Parameter_Output(Pose), &rotation, sizeof(rotation)), "Set pose output");
    check(NvAR_SetObject(handle, NvAR_Parameter_Output(PoseTranslation), &translation, sizeof(translation)), "Set translation output");
    check(NvAR_SetF32Array(handle, NvAR_Parameter_Output(ExpressionCoefficients), expressions.data(), count), "Set expression output");
    std::cout << "VTUBELEAF_NVIDIA {\"ready\":true}\n" << std::flush;

    while (std::cout.good()) {
      const auto started = std::chrono::steady_clock::now();
      if (!capture.read(frame) || frame.empty()) throw Failure{"Camera disconnected", 0};
      if (frame.cols != static_cast<int>(gpu.width) || frame.rows != static_cast<int>(gpu.height) || frame.type() != CV_8UC3)
        throw Failure{"Camera format changed; restart tracking", 0};
      NVWrapperForCVMat(&frame, &cpu);
      check(NvCVImage_Transfer(&cpu, &gpu, 1.f, nullptr, nullptr), "Upload camera frame");
      boxes.num_boxes = 0;
      check(NvAR_Run(handle), "FaceExpressions inference");
      std::ostringstream message;
      message.imbue(std::locale::classic());
      if (!boxes.num_boxes) {
        message << "{\"detected\":false}";
      } else {
        const std::array<float, 4> quaternion{rotation.x, rotation.y, rotation.z, rotation.w};
        for (float value : quaternion) if (!std::isfinite(value)) throw Failure{"Invalid pose output", 0};
        for (float value : expressions) if (!std::isfinite(value)) throw Failure{"Invalid expression output", 0};
        message << "{\"detected\":true,\"rotation\":[";
        for (size_t i = 0; i < quaternion.size(); ++i) message << (i ? "," : "") << quaternion[i];
        message << "],\"expressions\":[";
        for (size_t i = 0; i < expressions.size(); ++i) message << (i ? "," : "") << expressions[i];
        message << "]}";
      }
      std::cout << "VTUBELEAF_NVIDIA " + message.str() + "\n" << std::flush;
      std::this_thread::sleep_until(started + std::chrono::microseconds(1000000 / fps));
    }
    return 0;
  } catch (const Failure& error) {
    std::cout << "VTUBELEAF_NVIDIA {\"error\":\"" << error.stage << " (code " << error.code << ")\"}\n" << std::flush;
  } catch (const std::exception&) {
    std::cout << "VTUBELEAF_NVIDIA {\"error\":\"Camera or SDK operation failed\"}\n" << std::flush;
  }
  return 1;
}
