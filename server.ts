import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import multer from "multer";
import fs from "fs";
import { google } from "googleapis";
import { Readable } from "stream";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Ensure uploads directory exists
  const uploadsDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
  }

  // Configure multer for file uploads
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, "uploads/");
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, uniqueSuffix + "-" + file.originalname);
    },
  });
  const upload = multer({ storage });

  app.use(express.json());
  app.use("/uploads", express.static(uploadsDir));

  // API Routes
  app.post("/api/upload", upload.single("resume"), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    const fileUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
    res.json({ 
      url: fileUrl, 
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
      localPath: req.file.path
    });
  });

  async function findOrCreateFolder(drive: any, folderName: string, parentId?: string) {
    let query = `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    if (parentId) {
      query += ` and '${parentId}' in parents`;
    }
    
    const response = await drive.files.list({
      q: query,
      fields: 'files(id, name)',
      spaces: 'drive',
    });
    
    if (response.data.files && response.data.files.length > 0) {
      return response.data.files[0].id;
    }
    
    const fileMetadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : []
    };
    
    const folder = await drive.files.create({
      resource: fileMetadata,
      fields: 'id'
    });
    
    return folder.data.id;
  }

  app.post("/api/drive-upload", async (req, res) => {
    const { accessToken, roleName, candidateName, fileName, localPath, fileType } = req.body;
    
    if (!accessToken) {
      return res.status(400).json({ error: "Access token required" });
    }

    try {
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });
      const drive = google.drive({ version: 'v3', auth: oauth2Client });

      // 1. Find or create root "Resumes" folder
      const rootFolderId = await findOrCreateFolder(drive, "Resumes");
      
      // 2. Find or create role-based folder
      const roleFolderId = await findOrCreateFolder(drive, roleName, rootFolderId);
      
      // 3. Upload file
      const filePath = path.join(process.cwd(), localPath);
      const fileMetadata = {
        name: `${candidateName} - ${fileName}`,
        parents: [roleFolderId]
      };
      const media = {
        mimeType: fileType,
        body: fs.createReadStream(filePath)
      };
      
      const file = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id, webViewLink, webContentLink'
      });

      res.json({ 
        driveFileId: file.data.id, 
        driveLink: file.data.webViewLink,
        status: "success"
      });
    } catch (error: any) {
      console.error("Google Drive Upload Error:", error);
      res.status(500).json({ error: error.message || "Failed to upload to Google Drive" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
