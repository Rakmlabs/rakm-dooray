// macOS 알림 권한을 앱 프로세스 안에서 읽고 요청하는 작은 N-API 모듈.
// Electron 에는 권한을 조회하는 API 가 없고, 알림의 'show' 이벤트는 권한이 없어도 온다.
// 빌드: scripts/build-native.mjs (clang 으로 직접, Node-API 만 쓰므로 Electron 버전과 무관)
#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#include <node_api.h>

static const char *statusName(UNAuthorizationStatus s) {
  switch (s) {
    case UNAuthorizationStatusNotDetermined: return "notDetermined";
    case UNAuthorizationStatusDenied: return "denied";
    case UNAuthorizationStatusAuthorized: return "authorized";
    case UNAuthorizationStatusProvisional: return "provisional";
    default: return "unknown";
  }
}

static const char *settingName(UNNotificationSetting s) {
  switch (s) {
    case UNNotificationSettingEnabled: return "enabled";
    case UNNotificationSettingDisabled: return "disabled";
    default: return "notSupported";
  }
}

static void setStr(napi_env env, napi_value obj, const char *key, const char *val) {
  napi_value v;
  napi_create_string_utf8(env, val, NAPI_AUTO_LENGTH, &v);
  napi_set_named_property(env, obj, key, v);
}

// settings(): { status, alert, badge, sound, alertStyle } — 최대 3초 기다린다. 실패하면 null
static napi_value Settings(napi_env env, napi_callback_info info) {
  if (![NSBundle mainBundle].bundleIdentifier) {
    napi_value n;
    napi_get_null(env, &n);
    return n;
  }
  __block UNNotificationSettings *got = nil;
  dispatch_semaphore_t sem = dispatch_semaphore_create(0);
  [[UNUserNotificationCenter currentNotificationCenter] getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *s) {
    got = s;
    dispatch_semaphore_signal(sem);
  }];
  dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC));
  napi_value out;
  if (!got) {
    napi_get_null(env, &out);
    return out;
  }
  napi_create_object(env, &out);
  setStr(env, out, "status", statusName(got.authorizationStatus));
  setStr(env, out, "alert", settingName(got.alertSetting));
  setStr(env, out, "badge", settingName(got.badgeSetting));
  setStr(env, out, "sound", settingName(got.soundSetting));
  setStr(env, out, "center", settingName(got.notificationCenterSetting));
  return out;
}

// request(): 배너·소리·배지 권한을 요청한다. 결과는 기다리지 않는다 (사용자가 누를 때까지 걸릴 수 있다)
static napi_value Request(napi_env env, napi_callback_info info) {
  if ([NSBundle mainBundle].bundleIdentifier) {
    UNAuthorizationOptions opts = UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge;
    [[UNUserNotificationCenter currentNotificationCenter] requestAuthorizationWithOptions:opts
                                                                        completionHandler:^(BOOL granted, NSError *error) {}];
  }
  napi_value u;
  napi_get_undefined(env, &u);
  return u;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "settings", NAPI_AUTO_LENGTH, Settings, nullptr, &fn);
  napi_set_named_property(env, exports, "settings", fn);
  napi_create_function(env, "request", NAPI_AUTO_LENGTH, Request, nullptr, &fn);
  napi_set_named_property(env, exports, "request", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
