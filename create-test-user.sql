INSERT INTO "User" (id, username, password, role, "realName", "isOnline", "createdAt", "updatedAt") 
VALUES ('test-user-1', 'testuser1', '$2b$10$m1Wmz/y4RyPCmZViBHtGJOsym5mEtUcwvpZe/KwmLVMi6ajHDFapK', 'AGENT', 'Test User 1', false, NOW(), NOW()) 
ON CONFLICT (username) DO NOTHING;

INSERT INTO "User" (id, username, password, role, "realName", "isOnline", "createdAt", "updatedAt") 
VALUES ('admin-user-1', 'admin', '$2b$10$m1Wmz/y4RyPCmZViBHtGJOsym5mEtUcwvpZe/KwmLVMi6ajHDFapK', 'ADMIN', 'Admin User', false, NOW(), NOW()) 
ON CONFLICT (username) DO NOTHING;
