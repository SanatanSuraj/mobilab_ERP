// API client — currently returns mock data, ready for real backend
// When backend is live: set NEXT_PUBLIC_API_URL env var

export type ApiError = {
  message: string;
  code?: string;
  status?: number;
};

// Mock delay to simulate network
const MOCK_DELAY = 300;

export async function mockFetch<T>(data: T, delay = MOCK_DELAY): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(data), delay));
}

export async function mockError(code: string, message: string, delay = MOCK_DELAY): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject({ message, code, status: 422 } as ApiError), delay)
  );
}
