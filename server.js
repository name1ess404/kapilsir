require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

const storage = multer.memoryStorage();
// FIXED: Allow up to 30 files in a single batch request
const upload = multer({ storage: storage }).array('files', 30); 

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase Environment Variables!");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Endpoint 1: Fetch clean, unique categories straight from the DB
app.get('/api/folders', async (req, res) => {
  try {
    const { data, error } = await supabase.from('files').select('category');
    if (error) throw error;
    
    const uniqueCategories = [...new Set(data.map(item => item.category))]
      .filter(Boolean)
      .sort();

    const folderPayload = uniqueCategories.map(category => ({
      id: category, 
      name: category
    }));

    res.json(folderPayload);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch folder categories" });
  }
});

// Endpoint 2: Fetch files safely by their exact category string ID
app.get('/api/files/:categoryName', async (req, res) => {
  try {
    const categoryName = req.params.categoryName;

    const { data: files, error } = await supabase
      .from('files')
      .select('id, name, category, size, url')
      .eq('category', categoryName);

    if (error) throw error;
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch files" });
  }
});

// FIXED Endpoint 3: Upload MULTIPLE PDFs simultaneously
app.post('/api/upload', (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || "Multer allocation limit error." });
    }

    try {
      const { category, customCategory } = req.body;
      const files = req.files; // Array of multiple files

      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      let finalCategory = category === 'NEW' ? customCategory : category;
      if (!finalCategory || finalCategory.trim() === '') {
        return res.status(400).json({ error: "Category name is required" });
      }
      finalCategory = finalCategory.trim();
      const bucketName = 'kapil-assets';

      // We'll process all uploads concurrently using Promise.all
      await Promise.all(files.map(async (file) => {
        const fileName = file.originalname;
        const sizeKb = file.size / 1024;
        const sizeStr = sizeKb >= 1024 
          ? `${(sizeKb / 1024).toFixed(2)} MB` 
          : `${sizeKb.toFixed(2)} KB`;

        const storagePath = `${finalCategory}/${fileName}`;

        // 1. Upload file binary into Supabase Storage Bucket
        const { error: storageError } = await supabase.storage
          .from(bucketName)
          .upload(storagePath, file.buffer, {
            contentType: file.mimetype,
            upsert: true 
          });

        if (storageError) throw storageError;

        // 2. Compute path link addresses dynamically
        const publicUrl = `${supabaseUrl}/storage/v1/object/public/${bucketName}/${encodeURIComponent(finalCategory)}/${encodeURIComponent(fileName)}`;

        // 3. Write metadata tracker row inside files relational table
        const { error: dbError } = await supabase
          .from('files')
          .insert([{ name: fileName, category: finalCategory, size: sizeStr, url: publicUrl }]);

        if (dbError) throw dbError;
      }));

      res.json({ success: true, message: `Successfully added ${files.length} files` });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || "An error occurred during bulk file processing." });
    }
  });
});

// Endpoint 4: Delete file completely safely
app.delete('/api/files/:id', async (req, res) => {
  try {
    const fileId = req.params.id;

    const { data: fileData, error: fetchError } = await supabase
      .from('files')
      .select('name, category')
      .eq('id', fileId)
      .single();

    if (fetchError || !fileData) return res.status(404).json({ error: "File not found" });

    const bucketName = 'kapil-assets';
    const storagePath = `${fileData.category}/${fileData.name}`;

    await supabase.storage.from(bucketName).remove([storagePath]);

    const { error: dbError } = await supabase.from('files').delete().eq('id', fileId);
    if (dbError) throw dbError;

    res.json({ success: true, message: "File removed completely!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed deletion operation" });
  }
});

// Add this near your other routes
app.get('/ping', (req, res) => {
    res.status(200).send('pong');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
