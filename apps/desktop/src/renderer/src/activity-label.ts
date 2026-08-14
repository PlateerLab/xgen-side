import type { PersistedRunActivity, SkillRoute } from '../../shared/contracts';

export function activityLabel(
  name: string,
  index: number,
  activities: PersistedRunActivity[],
  route: SkillRoute,
): string {
  if (name.startsWith('Read ')) return name;
  const tool = name.split('.').at(-1) ?? name;
  if (!route.skills.some((skill) => skill.id === 'xgen.login-assistant')) return tool.replace(/^agent_browser_/, '').replaceAll('_', ' ');
  const ordinal = activities.slice(0, index + 1).filter((activity) => activity.name.endsWith(tool)).length;
  if (tool.endsWith('tab_list')) return '네이버 탭 확인';
  if (tool.endsWith('tab_switch')) return ordinal === 1 ? '네이버 탭 전환' : '네이버 로그인 상태 확인';
  if (tool.endsWith('session_info')) return '네이버 로그인 상태 확인';
  if (tool.endsWith('auth_login')) return '저장된 네이버 계정 확인';
  if (tool.endsWith('open')) return ordinal === 1 ? '네이버 로그인 준비' : '네이버 로그인 페이지 열기';
  if (tool.endsWith('click')) return ['네이버 로그인 페이지 열기', '패스키 로그인 시도', 'QR 로그인 준비'][Math.min(ordinal - 1, 2)]!;
  if (tool.endsWith('snapshot')) return ['네이버 로그인 상태 확인', '자동완성 옵션 확인', '패스키 요청 상태 확인', 'QR 로그인 상태 확인'][Math.min(ordinal - 1, 3)]!;
  if (tool.endsWith('get_url') || tool.endsWith('get_title')) return '로그인 요청 상태 확인';
  if (tool.includes('wait')) return '로그인 화면 대기';
  return tool.replace(/^agent_browser_/, '').replaceAll('_', ' ');
}
