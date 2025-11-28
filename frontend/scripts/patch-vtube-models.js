#!/usr/bin/env node

/**
 * VTuber Studio Model Patcher
 * 
 * This script automatically patches model3.json files for VTuber Studio models
 * by scanning the directory for expression and motion files and adding them
 * to the FileReferences section.
 */

const fs = require('fs');
const path = require('path');

function patchVTuberStudioModel(modelDir) {
  console.log(`\n📁 Processing: ${modelDir}`);
  
  // Find the model3.json file
  const files = fs.readdirSync(modelDir);
  const model3JsonFile = files.find(f => f.endsWith('.model3.json'));
  
  if (!model3JsonFile) {
    console.error('❌ No .model3.json file found in directory');
    return false;
  }
  
  const modelJsonPath = path.join(modelDir, model3JsonFile);
  const vtubePath = path.join(modelDir, model3JsonFile.replace('.model3.json', '.vtube.json'));
  
  // Check if this is a VTuber Studio model
  if (!fs.existsSync(vtubePath)) {
    console.log('⏭️  Not a VTuber Studio model (no .vtube.json found), skipping...');
    return false;
  }
  
  console.log(`✓ Found VTuber Studio model: ${model3JsonFile}`);
  
  // Read existing model3.json
  const modelJson = JSON.parse(fs.readFileSync(modelJsonPath, 'utf-8'));
  
  // Check if already patched
  if (modelJson.FileReferences.Expressions && modelJson.FileReferences.Expressions.length > 0) {
    console.log('⏭️  Model already has expressions defined, skipping...');
    return false;
  }
  
  // Scan for expression files
  const expressionFiles = files.filter(f => f.endsWith('.exp3.json'));
  const expressions = expressionFiles.map(f => ({
    Name: f.replace('.exp3.json', ''),
    File: f
  }));
  
  console.log(`✓ Found ${expressions.length} expression files`);
  
  // Scan for motion files
  const motionFiles = files.filter(f => f.endsWith('.motion3.json'));
  const motions = motionFiles.map(f => ({ File: f }));
  
  console.log(`✓ Found ${motions.length} motion files`);
  
  // Create backup
  const backupPath = modelJsonPath + '.backup';
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(modelJsonPath, backupPath);
    console.log(`✓ Created backup: ${path.basename(backupPath)}`);
  }
  
  // Update model3.json
  modelJson.FileReferences.Expressions = expressions;
  
  if (!modelJson.FileReferences.Motions) {
    modelJson.FileReferences.Motions = {};
  }
  
  // Group motions by name or use "Custom" as default
  if (motions.length > 0) {
    modelJson.FileReferences.Motions.Custom = motions;
  }
  
  // Write updated model3.json
  fs.writeFileSync(modelJsonPath, JSON.stringify(modelJson, null, '\t'));
  
  console.log(`✅ Successfully patched ${model3JsonFile}`);
  console.log(`   - Added ${expressions.length} expressions`);
  console.log(`   - Added ${motions.length} motions`);
  
  return true;
}

function scanCommercialModels(commercialModelsPath) {
  if (!fs.existsSync(commercialModelsPath)) {
    console.error(`❌ Commercial models directory not found: ${commercialModelsPath}`);
    return;
  }
  
  const entries = fs.readdirSync(commercialModelsPath, { withFileTypes: true });
  const modelDirs = entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => path.join(commercialModelsPath, entry.name));
  
  console.log(`\n🔍 Found ${modelDirs.length} potential model directories\n`);
  console.log('='.repeat(60));
  
  let patchedCount = 0;
  
  for (const modelDir of modelDirs) {
    if (patchVTuberStudioModel(modelDir)) {
      patchedCount++;
    }
    console.log('='.repeat(60));
  }
  
  console.log(`\n✨ Patching complete! ${patchedCount} model(s) patched.`);
  
  if (patchedCount > 0) {
    console.log('\n⚠️  Please restart your development server for changes to take effect.');
  }
}

// Main execution
const commercialModelsPath = path.join(__dirname, '..', 'public', 'Resources', 'Commercial_models');

console.log('🚀 VTuber Studio Model Patcher');
console.log('================================\n');
console.log(`Scanning: ${commercialModelsPath}\n`);

scanCommercialModels(commercialModelsPath);

