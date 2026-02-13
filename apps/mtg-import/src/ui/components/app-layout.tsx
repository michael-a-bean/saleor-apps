import { Box, Text } from "@saleor/macaw-ui";
import Link from "next/link";
import { useRouter } from "next/router";
import { ReactNode } from "react";

interface NavItemProps {
  href: string;
  label: string;
  isActive: boolean;
}

const NavItem = ({ href, label, isActive }: NavItemProps) => (
  <Link href={href} style={{ textDecoration: "none" }}>
    <Box
      paddingX={4}
      paddingY={3}
      borderRadius={2}
      backgroundColor={isActive ? "default2" : undefined}
      cursor="pointer"
      className="nav-item"
    >
      <Text fontWeight={isActive ? "bold" : "regular"}>{label}</Text>
    </Box>
  </Link>
);

interface AppLayoutProps {
  children: ReactNode;
}

export const AppLayout = ({ children }: AppLayoutProps) => {
  const router = useRouter();
  const currentPath = router.pathname;

  const navItems = [
    { href: "/import", label: "Import Jobs" },
    { href: "/sets", label: "Sets" },
  ];

  return (
    <Box display="flex" gap={6}>
      <Box
        __width="200px"
        __minWidth="200px"
        display="flex"
        flexDirection="column"
        gap={1}
        paddingTop={2}
      >
        <Box marginBottom={4}>
          <Text size={6} fontWeight="bold">
            MTG Import
          </Text>
        </Box>
        {navItems.map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            isActive={currentPath.startsWith(item.href)}
          />
        ))}
      </Box>

      <Box __flex="1">{children}</Box>
    </Box>
  );
};
