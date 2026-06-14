require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve frontend files

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase Environment Variables!");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Global category mapping to safely cross-reference folderIds across stateless requests
let categoryMappingCache = [];

/**
 * Helper function to dynamically synchronize unique database categories to sequential IDs
 */
async function refreshCategoryCache() {
  try {
    const { data, error } = await supabase
      .from('files')
      .select('category');

    if (error) throw error;

    // Extract unique, sorted categories
    const uniqueCategories = [...new Set(data.map(item => item.category))].sort();
    
    categoryMappingCache = uniqueCategories.map((category, index) => ({
      id: index,
      name: category
    }));
  } catch (error) {
    console.error("Error updating category cache:", error.message);
  }
}

/**
 * Endpoint 1: Fetch unique categories structured with matching sequential IDs
 */
app.get('/api/folders', async (req, res) => {
  try {
    await refreshCategoryCache();
    res.json(categoryMappingCache);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch folder categories" });
  }
});

/**
 * Endpoint 2: Map numeric folderId back to category name and fetch files
 */
app.get('/api/files/:folderId', async (req, res) => {
  try {
    const targetId = parseInt(req.params.folderId, 10);
    
    // Refresh cache if requested ID falls outside cached boundaries
    if (categoryMappingCache.length === 0 || !categoryMappingCache.find(c => c.id === targetId)) {
      await refreshCategoryCache();
    }

    const categoryMatch = categoryMappingCache.find(c => c.id === targetId);

    if (!categoryMatch) {
      return res.status(404).json({ error: "Folder category not found" });
    }

    // Query rows belonging to target category
    const { data: files, error } = await supabase
      .from('files')
      .select('id, name, category, size, url')
      .eq('category', categoryMatch.name);

    if (error) throw error;

    res.json(files);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch files from storage" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
