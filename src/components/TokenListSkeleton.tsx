const TokenListSkeleton = () => {
  // Create 10 skeleton rows
  return (
    <>
      {[...Array(10)].map((_, index) => (
        <tr key={index} className="animate-pulse border-b border-white/20">
          <td className="px-4 py-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-white/20 rounded-full" />
              <div className="flex flex-col gap-2">
                <div className="h-4 w-24 bg-white/20 rounded" />
                <div className="h-3 w-20 bg-white/20 rounded" />
              </div>
            </div>
          </td>
          <td className="px-4 py-4">
            <div className="h-4 w-28 bg-white/20 rounded" />
          </td>
          <td className="px-4 py-4">
            <div className="h-4 w-24 bg-white/20 rounded" />
          </td>
          <td className="px-4 py-4">
            <div className="flex justify-end">
              <div className="h-8 w-28 bg-white/20 rounded" />
            </div>
          </td>
        </tr>
      ))}
    </>
  );
};

export default TokenListSkeleton; 