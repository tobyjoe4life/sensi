import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntelligenceEngine } from '../IntelligenceEngine';
import { SessionTracker } from '../SessionTracker';

vi.mock('../services/SettingsManager', () => ({
    SettingsManager: {
        getInstance: () => ({
            get: (key: string) => {
                if (key === 'interviewProfile') {
                    return { answerStyleDefault: 'elaborate' };
                }
                return undefined;
            },
        }),
    },
}));

const engines: IntelligenceEngine[] = [];

afterEach(() => {
    while (engines.length > 0) {
        engines.pop()?.destroy();
    }
});

function makeEngine(): IntelligenceEngine {
    const engine = new IntelligenceEngine({} as any, new SessionTracker());
    engines.push(engine);
    return engine;
}

describe('Interview answer style session state', () => {
    it('uses the saved default until a session override is set', () => {
        const engine = makeEngine();

        expect(engine.getSessionAnswerStyle()).toBe('elaborate');

        engine.setSessionAnswerStyle('star');
        expect(engine.getSessionAnswerStyle()).toBe('star');

        engine.reset();
        expect(engine.getSessionAnswerStyle()).toBe('star');

        engine.clearSessionAnswerStyleOverride();
        expect(engine.getSessionAnswerStyle()).toBe('elaborate');
    });
});
