export function localDay(value: Date | number = new Date()): string {
	const date = typeof value === "number" ? new Date(value) : value;
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export function isAfterDay(candidate: string, baseline: string): boolean {
	return candidate > baseline;
}

export function shouldShowAnnotationTooltip(
	day: string,
	today = localDay(),
	showCurrentDay = false,
): boolean {
	return showCurrentDay || day !== today;
}

export function formatAnnotationDay(day: string, locale?: string): string {
	const parts = day.split("-").map((part) => Number(part));
	const [year, month, date] = parts;
	if (
		year === undefined ||
		month === undefined ||
		date === undefined ||
		!Number.isInteger(year) ||
		!Number.isInteger(month) ||
		!Number.isInteger(date)
	) {
		return day;
	}
	const value = new Date(year, month - 1, date);
	return new Intl.DateTimeFormat(locale, {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
	}).format(value);
}
