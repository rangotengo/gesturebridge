import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMirrorEffects } from '../hooks/useMirrorEffects';
import { useBlowDetection } from '../hooks/useBlowDetection';
import { useFacePucker } from '../hooks/useFacePucker';

vi.mock('../hooks/useBlowDetection', () => ({
  useBlowDetection: vi.fn(() => ({ microphoneStatus: 'available', isMicrophoneAvailable: true })),
}));
vi.mock('../hooks/useFacePucker', () => ({
  useFacePucker: vi.fn(() => ({ isLoading: false, isAvailable: true, error: null })),
}));

function renderMirror(enabled: boolean, onFog = vi.fn()) {
  const videoRef = { current: null };
  function Harness() {
    useMirrorEffects(enabled, videoRef, onFog);
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return {
    onFog,
    blow: vi.mocked(useBlowDetection).mock.calls.at(-1)![0],
    face: vi.mocked(useFacePucker).mock.calls.at(-1)![0],
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('Mirror mode detector integration', () => {
  it('keeps mouth detection enabled when microphone capture is available', () => {
    const { blow, face } = renderMirror(true);
    expect(blow.enabled).toBe(true);
    expect(face.enabled).toBe(true);
  });

  it('adds fog from a pucker even when the microphone detects nothing', () => {
    const { face, onFog } = renderMirror(true);
    face.onPucker();
    expect(onFog).toHaveBeenCalledOnce();
  });

  it('coalesces a breath observed by both detectors and accepts later breaths', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1_000);
    const { blow, face, onFog } = renderMirror(true);
    blow.onBlow();
    clock.mockReturnValue(1_100);
    face.onPucker();
    expect(onFog).toHaveBeenCalledOnce();
    clock.mockReturnValue(2_500);
    face.onPucker();
    expect(onFog).toHaveBeenCalledTimes(2);
  });

  it('disables both detectors and ignores late callbacks while inactive', () => {
    const { blow, face, onFog } = renderMirror(false);
    expect(blow.enabled).toBe(false);
    expect(face.enabled).toBe(false);
    blow.onBlow();
    face.onPucker();
    expect(onFog).not.toHaveBeenCalled();
  });
});
