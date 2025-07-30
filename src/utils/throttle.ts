/**
 * Creates a debounced version of the provided function.
 * The debounced function delays the execution of the original function
 * until after the specified delay has elapsed since the last time it was invoked.
 * @param func The function to debounce.
 * @param delay The delay in milliseconds.
 * @returns A debounced version of the provided function.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce<T extends (...args: any[]) => any>(
	func: T,
	delay: number
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
	let timeout: NodeJS.Timeout | null = null;

	return (...args: Parameters<T>): Promise<ReturnType<T>> => {
		console.log("debounce");
		return new Promise((resolve) => {
			// Clear any existing timeout to reset the timer
			if (timeout) {
				clearTimeout(timeout);
			}

			// Set a new timeout to execute the function after the delay
			timeout = setTimeout(() => {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
				resolve(func(...args));
			}, delay);
		});
	};
}
