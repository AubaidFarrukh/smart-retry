import {
  generateId,
  calculateDelay,
  defaultShouldRetry,
  sleep,
  getErrorMessage,
  getStatusCode,
} from '../src/utils';

describe('Utils', () => {
  describe('generateId', () => {
    it('should generate a valid UUID', () => {
      const id = generateId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('should generate unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('calculateDelay', () => {
    it('should calculate exponential backoff correctly', () => {
      expect(calculateDelay(1000, 1, 'exponential')).toBe(1000);
      expect(calculateDelay(1000, 2, 'exponential')).toBe(2000);
      expect(calculateDelay(1000, 3, 'exponential')).toBe(4000);
      expect(calculateDelay(1000, 4, 'exponential')).toBe(8000);
    });

    it('should calculate linear backoff correctly', () => {
      expect(calculateDelay(1000, 1, 'linear')).toBe(1000);
      expect(calculateDelay(1000, 2, 'linear')).toBe(2000);
      expect(calculateDelay(1000, 3, 'linear')).toBe(3000);
      expect(calculateDelay(1000, 4, 'linear')).toBe(4000);
    });

    it('should return fixed delay for none backoff', () => {
      expect(calculateDelay(1000, 1, 'none')).toBe(1000);
      expect(calculateDelay(1000, 2, 'none')).toBe(1000);
      expect(calculateDelay(1000, 3, 'none')).toBe(1000);
    });
  });

  describe('defaultShouldRetry', () => {
    it('should retry on network errors', () => {
      expect(defaultShouldRetry({ code: 'ECONNREFUSED' })).toBe(true);
      expect(defaultShouldRetry({ code: 'ETIMEDOUT' })).toBe(true);
      expect(defaultShouldRetry({ code: 'ENOTFOUND' })).toBe(true);
      expect(defaultShouldRetry({ code: 'ECONNRESET' })).toBe(true);
    });

    it('should retry on 5xx errors', () => {
      expect(defaultShouldRetry({ response: { status: 500 } })).toBe(true);
      expect(defaultShouldRetry({ response: { status: 502 } })).toBe(true);
      expect(defaultShouldRetry({ response: { status: 503 } })).toBe(true);
      expect(defaultShouldRetry({ response: { status: 504 } })).toBe(true);
    });

    it('should retry on 408 and 429', () => {
      expect(defaultShouldRetry({ response: { status: 408 } })).toBe(true);
      expect(defaultShouldRetry({ response: { status: 429 } })).toBe(true);
    });

    it('should not retry on 4xx errors (except 408, 429)', () => {
      expect(defaultShouldRetry({ response: { status: 400 } })).toBe(false);
      expect(defaultShouldRetry({ response: { status: 401 } })).toBe(false);
      expect(defaultShouldRetry({ response: { status: 403 } })).toBe(false);
      expect(defaultShouldRetry({ response: { status: 404 } })).toBe(false);
    });

    it('should not retry on null/undefined', () => {
      expect(defaultShouldRetry(null)).toBe(false);
      expect(defaultShouldRetry(undefined)).toBe(false);
    });
  });

  describe('sleep', () => {
    it('should delay for specified milliseconds', async () => {
      const start = Date.now();
      await sleep(100);
      const duration = Date.now() - start;
      expect(duration).toBeGreaterThanOrEqual(95);
      expect(duration).toBeLessThan(150);
    });
  });

  describe('getErrorMessage', () => {
    it('should extract message from response statusText', () => {
      const error = { response: { statusText: 'Not Found' } };
      expect(getErrorMessage(error)).toBe('Not Found');
    });

    it('should extract message from error.message', () => {
      const error = new Error('Connection timeout');
      expect(getErrorMessage(error)).toBe('Connection timeout');
    });

    it('should convert to string for unknown errors', () => {
      expect(getErrorMessage('string error')).toBe('string error');
      expect(getErrorMessage(123)).toBe('123');
    });
  });

  describe('getStatusCode', () => {
    it('should extract status code from error', () => {
      const error = { response: { status: 404 } };
      expect(getStatusCode(error)).toBe(404);
    });

    it('should return undefined for non-HTTP errors', () => {
      const error = new Error('Network error');
      expect(getStatusCode(error)).toBeUndefined();
    });
  });
});
