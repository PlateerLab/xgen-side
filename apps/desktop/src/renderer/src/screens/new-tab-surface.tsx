import {
  Add24Regular,
  ArrowRight24Regular,
  BotSparkle24Filled,
  CheckmarkSquare24Filled,
  ChevronDown24Regular,
  Color24Filled,
  Document24Regular,
  Flash24Filled,
  Mic24Regular,
  Search24Regular,
  ShieldLock24Regular,
} from '@fluentui/react-icons';
import type { FormEvent, ReactElement } from 'react';
import customizeImage from '../assets/new-tab/customize.png';
import memoryImage from '../assets/new-tab/memory.png';
import routinesImage from '../assets/new-tab/routines.png';

export type NewTabMode = 'search' | 'ask';

interface NewTabSurfaceProps {
  leftWidth: number;
  mode: NewTabMode;
  onChangeMode(value: NewTabMode): void;
  onChangeValue(value: string): void;
  onOpenSettings(): void;
  onSubmit(event: FormEvent): void;
  onUsePrompt(prompt: string): void;
  value: string;
}

const suggestions = [
  {
    title: 'Set up XGEN Side memory',
    description: '작업 맥락을 기억하도록 설정해 다음 요청을 더 짧고 정확하게 시작합니다.',
    action: 'Use this prompt',
    prompt: '내 작업 방식과 선호를 기억할 수 있도록 메모리 설정을 도와줘',
    icon: <CheckmarkSquare24Filled />,
    image: memoryImage,
  },
  {
    title: 'Automate my routines',
    description: '최근 반복 작업을 살펴보고 자동화할 수 있는 루틴을 제안합니다.',
    action: 'Use this prompt',
    prompt: '내 최근 작업에서 반복되는 패턴을 찾아 자동화 루틴을 제안해줘',
    icon: <Flash24Filled />,
    image: routinesImage,
  },
  {
    title: 'Customize XGEN Side',
    description: 'Skills, Memory, 권한과 기본 모델을 현재 작업 방식에 맞춥니다.',
    action: 'Open Settings',
    prompt: '',
    icon: <Color24Filled />,
    image: customizeImage,
  },
];

export function NewTabSurface(props: NewTabSurfaceProps): ReactElement {
  return (
    <section className="new-tab-surface" style={{ left: props.leftWidth }}>
      <div className="new-tab-content">
        <span className="new-tab-mark"><BotSparkle24Filled /></span>
        <form className={props.mode === 'ask' ? 'new-tab-composer ask-mode' : 'new-tab-composer search-mode'} onSubmit={props.onSubmit}>
          <div className="new-tab-search">
            {props.mode === 'search' && <Search24Regular />}
            <input
              aria-label={props.mode === 'search' ? '검색어 또는 URL' : 'AI에게 요청'}
              autoFocus
              onChange={(event) => props.onChangeValue(event.target.value)}
              placeholder={props.mode === 'search' ? 'Search or type a URL' : 'Ask AI a task, @ for context'}
              value={props.value}
            />
            <span className="new-tab-switch-hint"><kbd>Tab</kbd><span>to switch</span></span>
            <div className="new-tab-mode" role="tablist" aria-label="새 탭 입력 모드">
              <button className={props.mode === 'search' ? 'active' : ''} type="button" role="tab" aria-selected={props.mode === 'search'} onClick={() => props.onChangeMode('search')}>Search</button>
              <button className={props.mode === 'ask' ? 'active' : ''} type="button" role="tab" aria-selected={props.mode === 'ask'} onClick={() => props.onChangeMode('ask')}>Ask AI</button>
            </div>
          </div>
          {props.mode === 'ask' && <div className="new-tab-ask-tools">
            <div>
              <button type="button" aria-label="컨텍스트 추가"><Add24Regular /></button>
              <button type="button"><Document24Regular />Project<ChevronDown24Regular /></button>
              <button type="button"><ShieldLock24Regular />Guard<ChevronDown24Regular /></button>
            </div>
            <div>
              <button type="button"><BotSparkle24Filled />GPT-5.6 Sol<ChevronDown24Regular /></button>
              <button type="button">High<ChevronDown24Regular /></button>
              <button type="button" aria-label="음성 입력"><Mic24Regular /></button>
              {props.value.trim() && <button className="new-tab-submit" type="submit" aria-label="Ask AI 요청 전송"><ArrowRight24Regular /></button>}
            </div>
          </div>}
        </form>
        <section className="suggested-tasks" aria-label="추천 작업">
          <h2>Suggested tasks</h2>
          <div className="suggested-task-grid">
            {suggestions.map((suggestion) => (
              <article className="suggested-task" key={suggestion.title}>
                <div className="suggested-task-visual">
                  <span>{suggestion.icon}</span>
                  <img src={suggestion.image} alt="" />
                </div>
                <div className="suggested-task-copy">
                  <h3>{suggestion.title}</h3>
                  <p>{suggestion.description}</p>
                  <button type="button" onClick={suggestion.prompt ? () => props.onUsePrompt(suggestion.prompt) : props.onOpenSettings}>{suggestion.action}<ArrowRight24Regular /></button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
