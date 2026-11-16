interface PageSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label?: string;
  count?: string;
}

export function PageSearch({ value, onChange, placeholder, label = 'Search', count }: PageSearchProps) {
  return (
    <div className="page-search">
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
      />
      {count && <span className="page-search-count">{count}</span>}
    </div>
  );
}
