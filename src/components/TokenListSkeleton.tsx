const TokenListSkeleton = () => {
  // Create 10 skeleton rows
  return (
    <>
      {[...Array(10)].map((_, index) => (
        <tr key={index} className="animate-pulse border-b border-white/20">
          <td className="p-4">
            <div className="flex items-center">
              <input
                type="checkbox"
                disabled
                defaultChecked={false}
                className="w-4 h-4 text-white bg-gray-100 border-gray-300 rounded focus:ring-white/50 dark:focus:ring-white/50 dark:ring-offset-gray-800 dark:focus:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
              />
            </div>
          </td>
          <td className="px-6 py-3">
            <div className="h-4 w-24 bg-white/20 rounded" />
          </td>
          <td className="px-6 py-3">
            <div className="h-4 w-28 bg-white/20 rounded" />
          </td>
          <td className="px-6 py-3">
            <div className="h-4 w-24 bg-white/20 rounded" />
          </td>
        </tr>
      ))}
    </>
  );
};

export default TokenListSkeleton; 