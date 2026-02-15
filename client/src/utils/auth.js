export const getUser = () => {
  const data = localStorage.getItem("user");

  if (!data) return null;     // ✅ prevent JSON.parse(undefined)

  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
};

export const isLoggedIn = () => {
  return !!localStorage.getItem("token");
};

export const isAdmin = () => {
  const user = getUser();
  return user?.role === "admin";
};
