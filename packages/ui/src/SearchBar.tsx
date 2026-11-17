import type { FormHTMLAttributes } from "react";

export function SearchBar({
  placeholder = "Search for seeds, fertilizers, tractors, tools...",
  defaultValue,
  className = "",
  ...props
}: FormHTMLAttributes<HTMLFormElement> & { placeholder?: string; defaultValue?: string }) {
  return (
    <form className={`flex w-full ${className}`} role="search" {...props}>
      <input
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-label="Search products"
        className="min-w-0 flex-1 rounded-l-lg border-2 border-r-0 border-green-600 px-4 py-2.5 text-sm text-ink outline-none"
      />
      <button
        type="submit"
        className="shrink-0 rounded-r-lg border-2 border-green-600 bg-green-600 px-5 text-sm font-bold text-white transition-colors hover:bg-green-700"
      >
        Search
      </button>
    </form>
  );
}
