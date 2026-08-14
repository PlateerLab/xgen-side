export type DesktopAuthPlatform = 'macos' | 'windows' | 'other';

export interface PlatformAuthCopy {
  title: string;
  detail: string;
  fallback: string;
}

export function detectDesktopAuthPlatform(userAgent: string, platform = ''): DesktopAuthPlatform {
  const input = `${platform} ${userAgent}`.toLowerCase();
  if (input.includes('win')) return 'windows';
  if (input.includes('mac')) return 'macos';
  return 'other';
}

export function platformAuthCopy(platform: DesktopAuthPlatform): PlatformAuthCopy {
  if (platform === 'macos') {
    return {
      title: 'Touch ID 또는 기기 암호가 필요합니다',
      detail: '열린 macOS 인증 창에서 직접 승인하면 브라우저 로그인이 계속됩니다.',
      fallback: '다른 기기의 passkey를 사용하려면 인증 창의 QR 옵션을 선택하세요.',
    };
  }
  if (platform === 'windows') {
    return {
      title: 'Windows Hello 인증이 필요합니다',
      detail: '열린 Windows 보안 창에서 얼굴, 지문, PIN 또는 보안 키로 직접 승인하세요.',
      fallback: '다른 기기의 passkey를 사용하려면 인증 창의 QR 옵션을 선택하세요.',
    };
  }
  return {
    title: '기기 passkey 인증이 필요합니다',
    detail: '열린 시스템 인증 창에서 직접 승인하면 브라우저 로그인이 계속됩니다.',
    fallback: '지원되는 경우 다른 기기 또는 보안 키를 선택할 수 있습니다.',
  };
}

export function qrAuthCopy(): PlatformAuthCopy {
  return {
    title: '네이버 앱에서 QR 인증이 필요합니다',
    detail: '화면의 QR 코드를 네이버 앱 렌즈로 스캔하고 표시된 숫자를 직접 선택하세요.',
    fallback: '인증이 끝나면 XGEN Side가 로그인 상태를 다시 확인할 수 있습니다.',
  };
}
