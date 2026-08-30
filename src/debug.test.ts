import { describe, it, expect, beforeEach } from 'vitest';
import { debug, setDebugSink, setDebugState, resetDebugBuffer } from './debug';

describe('debug', () => {
    beforeEach(() => {
        resetDebugBuffer();
    });

    it('does nothing observable when no sink is attached', () => {
        expect(() => debug('hello')).not.toThrow();
    });

    it('sends a single string arg as-is to the sink', () => {
        const received: string[] = [];
        debug('before sink attached');
        setDebugSink((text) => received.push(text));
        expect(received).toEqual(['before sink attached']);
    });

    it('replays the current buffer immediately when a sink attaches', () => {
        const received: string[] = [];
        debug('first');
        debug('second');
        setDebugSink((text) => received.push(text));
        expect(received).toEqual(['first\nsecond']);
    });

    it('joins multiple args with a space', () => {
        const received: string[] = [];
        setDebugSink((text) => received.push(text));
        debug('value:', 42);
        expect(received[received.length - 1]).toBe('value: 42');
    });

    it('JSON.stringifies non-string args', () => {
        const received: string[] = [];
        setDebugSink((text) => received.push(text));
        debug({ a: 1 });
        expect(received[received.length - 1]).toBe('{"a":1}');
    });

    it('appends each call as a new line', () => {
        const received: string[] = [];
        setDebugSink((text) => received.push(text));
        debug('line 1');
        debug('line 2');
        expect(received[received.length - 1]).toBe('line 1\nline 2');
    });

    it('shows only the state when no log lines exist', () => {
        const received: string[] = [];
        setDebugSink((text) => received.push(text));
        setDebugState('camera: offset=0');
        expect(received[received.length - 1]).toBe('camera: offset=0');
    });

    it('combines the state above the log, separated by a blank line', () => {
        const received: string[] = [];
        debug('log line');
        setDebugState('camera: offset=0');
        setDebugSink((text) => received.push(text));
        expect(received[received.length - 1]).toBe('camera: offset=0\n\nlog line');
    });

    it('clears the state on resetDebugBuffer', () => {
        const received: string[] = [];
        setDebugState('camera: offset=0');
        resetDebugBuffer();
        setDebugSink((text) => received.push(text));
        expect(received[received.length - 1]).toBe('');
    });

    it('drops the oldest line once more than 50 lines are buffered', () => {
        const received: string[] = [];
        setDebugSink((text) => received.push(text));
        for (let i = 1; i <= 51; i++) {
            debug('line ' + i);
        }
        const lastText = received[received.length - 1];
        const lines = lastText.split('\n');
        expect(lines.length).toBe(50);
        expect(lines[0]).toBe('line 2');
        expect(lines[lines.length - 1]).toBe('line 51');
    });

    it('setDebugSink(null) detaches the sink', () => {
        const received: string[] = [];
        setDebugSink((text) => received.push(text));
        setDebugSink(null);
        const countBeforeDetach = received.length;
        debug('should not be received');
        expect(received.length).toBe(countBeforeDetach);
    });
});
