const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DELETE_ENABLED = false; // STRLCTLY DISABLED FOR RUN 4

// Known Safe Test Prefixes and Namespaces
const SAFE_SOURCE_PATTERNS = /^(Test Verify|RAG Test|Evidence Test|Test DOI|Test Source|Fake Paper|Duplicate DOI|Big Paper|Big Study|Hallucinated study|Mock Live Study|Prone Posture Study|Temp Study)/i;
const SAFE_RULE_PATTERNS = /^(test_rule|legitimacy_test|conflict_test|rule_candidate_test|test_verify|temp_rule|mock_rule)/i;

// Broad suspicious patterns
const SUSPICIOUS_PATTERN = /test|mock|dummy|temp|delete_?me|asdf|qwerty/i;

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dreamscape';
  console.log('================================================================');
  console.log(`DATABASE AUDIT & CLEANUP SCRIPT (DRY-RUN ONLY FOR RUN 4)`);
  console.log(`Connecting to: ${uri}`);
  console.log('================================================================\n');

  try {
    await mongoose.connect(uri);
    const db = mongoose.connection.db;

    // Verify database collections exist
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    
    const requiredCollections = [
      'verified_knowledge_rules',
      'pending_knowledge_rules',
      'academic_sources',
      'academic_chunks',
      'dreams',
      'users',
      'knowledge_rule_evidences'
    ];

    for (const name of requiredCollections) {
      if (!collectionNames.includes(name)) {
        console.warn(`Warning: Collection '${name}' not found in database.`);
      }
    }

    // ─── 1. SCAN AND CLASSIFY RECORDS ───
    console.log('--- 1. SCANNING COLLECTIONS FOR TEST/SUSPICIOUS DATA ---');

    // Containers for categorized records
    const safeToDelete = [];
    const suspiciousToReview = [];
    const dangerousAuditOnly = [];

    // A. Scan Academic Sources
    if (collectionNames.includes('academic_sources')) {
      const sources = await db.collection('academic_sources').find({}).toArray();
      for (const s of sources) {
        const titleMatchSafe = s.title && SAFE_SOURCE_PATTERNS.test(s.title);
        const doiMatchSafe = s.doi && /test|mock/i.test(s.doi);
        
        const hasSuspiciousText = (s.title && SUSPICIOUS_PATTERN.test(s.title)) || 
                                  (s.doi && SUSPICIOUS_PATTERN.test(s.doi)) ||
                                  (s.url && SUSPICIOUS_PATTERN.test(s.url));

        if (titleMatchSafe || doiMatchSafe) {
          safeToDelete.push({
            collection: 'academic_sources',
            id: s._id,
            identifier: s.title || s.doi || s._id,
            details: `DOI: ${s.doi || 'N/A'}, readableInApp: ${s.readableInApp}`
          });
        } else if (hasSuspiciousText) {
          suspiciousToReview.push({
            collection: 'academic_sources',
            id: s._id,
            identifier: s.title || s.doi || s._id,
            details: `Possible test keyword in title/url/doi`
          });
        }
      }
    }

    // B. Scan Academic Chunks
    if (collectionNames.includes('academic_chunks')) {
      // Find chunks belonging to safe test sources
      const safeSourceIds = safeToDelete
        .filter(s => s.collection === 'academic_sources')
        .map(s => s.id);
        
      const chunks = await db.collection('academic_chunks').find({}).toArray();
      for (const c of chunks) {
        const isSafeSourceChunk = safeSourceIds.some(sid => sid.toString() === c.academicSourceId?.toString());
        const hasSuspiciousText = c.chunkText && SUSPICIOUS_PATTERN.test(c.chunkText);

        if (isSafeSourceChunk) {
          safeToDelete.push({
            collection: 'academic_chunks',
            id: c._id,
            identifier: `Chunk index ${c.chunkIndex} of source ${c.academicSourceId}`,
            details: `Belongs to safe test source. Length: ${c.chunkText?.length || 0}`
          });
        } else if (hasSuspiciousText) {
          suspiciousToReview.push({
            collection: 'academic_chunks',
            id: c._id,
            identifier: `Chunk index ${c.chunkIndex} of source ${c.academicSourceId}`,
            details: `Contains test keyword in content`
          });
        }
      }
    }

    // C. Scan Knowledge Rule Candidates
    if (collectionNames.includes('pending_knowledge_rules')) {
      const candidates = await db.collection('pending_knowledge_rules').find({}).toArray();
      for (const cand of candidates) {
        const labelSafe = cand.label && SAFE_SOURCE_PATTERNS.test(cand.label);
        const ruleIdSafe = cand.proposedRuleId && SAFE_RULE_PATTERNS.test(cand.proposedRuleId);
        const sourceTitleSafe = cand.sourceTitle && SAFE_SOURCE_PATTERNS.test(cand.sourceTitle);

        const hasSuspiciousText = (cand.label && SUSPICIOUS_PATTERN.test(cand.label)) ||
                                  (cand.proposedRuleId && SUSPICIOUS_PATTERN.test(cand.proposedRuleId)) ||
                                  (cand.scientificBasis && SUSPICIOUS_PATTERN.test(cand.scientificBasis));

        if (labelSafe || ruleIdSafe || sourceTitleSafe) {
          safeToDelete.push({
            collection: 'pending_knowledge_rules',
            id: cand._id,
            identifier: cand.proposedRuleId || cand.label,
            details: `Status: ${cand.status}, Label: ${cand.label}`
          });
        } else if (hasSuspiciousText) {
          suspiciousToReview.push({
            collection: 'pending_knowledge_rules',
            id: cand._id,
            identifier: cand.proposedRuleId || cand.label,
            details: `Possible test keyword in fields`
          });
        }
      }
    }

    // D. Scan Knowledge Rules
    if (collectionNames.includes('verified_knowledge_rules')) {
      const rules = await db.collection('verified_knowledge_rules').find({}).toArray();
      for (const r of rules) {
        const idSafe = r._id && SAFE_RULE_PATTERNS.test(r._id);
        const labelSafe = r.label && SAFE_SOURCE_PATTERNS.test(r.label);

        const hasSuspiciousText = (r._id && SUSPICIOUS_PATTERN.test(r._id)) ||
                                  (r.label && SUSPICIOUS_PATTERN.test(r.label)) ||
                                  (r.scientificBasis && SUSPICIOUS_PATTERN.test(r.scientificBasis));

        if (idSafe || labelSafe) {
          safeToDelete.push({
            collection: 'verified_knowledge_rules',
            id: r._id,
            identifier: r._id,
            details: `Origin: ${r.origin}, isActive: ${r.isActive}, Label: ${r.label}`
          });
        } else if (hasSuspiciousText) {
          suspiciousToReview.push({
            collection: 'verified_knowledge_rules',
            id: r._id,
            identifier: r._id,
            details: `Possible test keyword in rule ID/label/basis`
          });
        }
      }
    }

    // E. Scan Knowledge Rule Evidences
    if (collectionNames.includes('knowledge_rule_evidences')) {
      const links = await db.collection('knowledge_rule_evidences').find({}).toArray();
      const safeRuleIds = safeToDelete
        .filter(r => r.collection === 'verified_knowledge_rules')
        .map(r => r.id.toString());

      for (const link of links) {
        const isSafeRuleLink = safeRuleIds.includes(link.ruleId);
        const hasSuspiciousText = link.relevanceNote && SUSPICIOUS_PATTERN.test(link.relevanceNote);

        if (isSafeRuleLink) {
          safeToDelete.push({
            collection: 'knowledge_rule_evidences',
            id: link._id,
            identifier: `Link between rule ${link.ruleId} and source ${link.sourceId}`,
            details: `Status: ${link.status}`
          });
        } else if (hasSuspiciousText) {
          suspiciousToReview.push({
            collection: 'knowledge_rule_evidences',
            id: link._id,
            identifier: `Link between rule ${link.ruleId} and source ${link.sourceId}`,
            details: `Possible test keyword in relevanceNote`
          });
        }
      }
    }

    // F. Scan Users (Dangerous Audit-only)
    if (collectionNames.includes('users')) {
      const users = await db.collection('users').find({}).toArray();
      for (const u of users) {
        const isSuspicious = (u.username && SUSPICIOUS_PATTERN.test(u.username)) ||
                             (u.email && SUSPICIOUS_PATTERN.test(u.email)) ||
                             (u.display_name && SUSPICIOUS_PATTERN.test(u.display_name));
        if (isSuspicious) {
          dangerousAuditOnly.push({
            collection: 'users',
            id: u._id,
            identifier: u.username || u.email,
            details: `Email: ${u.email}, Role: ${u.role || 'user'}`
          });
        }
      }
    }

    // G. Scan Dreams (Dangerous Audit-only)
    if (collectionNames.includes('dreams')) {
      const dreams = await db.collection('dreams').find({}).toArray();
      for (const d of dreams) {
        const isSuspicious = d.content && SUSPICIOUS_PATTERN.test(d.content);
        if (isSuspicious) {
          dangerousAuditOnly.push({
            collection: 'dreams',
            id: d._id,
            identifier: `Dream by ${d.userId}`,
            details: `Content snippet: "${d.content.substring(0, 60)}..."`
          });
        }
      }
    }

    // Output Categorization Results
    console.log(`\nFound ${safeToDelete.length} Safe Test Namespace Records:`);
    if (safeToDelete.length === 0) console.log('  (None)');
    for (const r of safeToDelete) {
      console.log(`  [SAFE] Collection: ${r.collection} | ID: ${r.id} | Ident: ${r.identifier} (${r.details})`);
    }

    console.log(`\nFound ${suspiciousToReview.length} Suspicious Records (Require manual review):`);
    if (suspiciousToReview.length === 0) console.log('  (None)');
    for (const r of suspiciousToReview) {
      console.log(`  [SUSPICIOUS] Collection: ${r.collection} | ID: ${r.id} | Ident: ${r.identifier} (${r.details})`);
    }

    console.log(`\nFound ${dangerousAuditOnly.length} Dangerous Audit-Only Records (Users/Dreams - CANNOT delete):`);
    if (dangerousAuditOnly.length === 0) console.log('  (None)');
    for (const r of dangerousAuditOnly) {
      console.log(`  [DANGEROUS-AUDIT] Collection: ${r.collection} | ID: ${r.id} | Ident: ${r.identifier} (${r.details})`);
    }

    // ─── 2. DATABASE INTEGRITY CHECKS ───
    console.log('\n--- 2. DATABASE INTEGRITY & ORPHAN CHECKS ---');

    const integrityReports = [];

    // A. Orphan KnowledgeRuleEvidence links
    if (collectionNames.includes('knowledge_rule_evidences')) {
      const links = await db.collection('knowledge_rule_evidences').find({}).toArray();
      for (const link of links) {
        const ruleExists = await db.collection('verified_knowledge_rules').findOne({ _id: link.ruleId });
        const sourceExists = await db.collection('academic_sources').findOne({ _id: link.sourceId });
        
        if (!ruleExists || !sourceExists) {
          integrityReports.push({
            type: 'orphan_evidence_link',
            id: link._id,
            details: `Link points to missing rule (${!ruleExists}) or missing source (${!sourceExists})`
          });
        }
      }
    }

    // B. Active rules with missing or inactive links
    if (collectionNames.includes('verified_knowledge_rules')) {
      const activeGenRules = await db.collection('verified_knowledge_rules').find({ isActive: true, origin: 'source_generated' }).toArray();
      for (const rule of activeGenRules) {
        const links = await db.collection('knowledge_rule_evidences').find({ ruleId: rule._id }).toArray();
        if (links.length === 0) {
          integrityReports.push({
            type: 'active_rule_no_links',
            id: rule._id,
            details: `Rule '${rule.label}' is active but has no evidence links`
          });
        } else {
          const hasActiveLink = links.some(l => l.status === 'active');
          if (!hasActiveLink) {
            integrityReports.push({
              type: 'active_rule_inactive_links_only',
              id: rule._id,
              details: `Rule '${rule.label}' is active but all of its ${links.length} evidence link(s) are inactive`
            });
          }
        }
      }
    }

    // C. Inactive rules with active links
    if (collectionNames.includes('verified_knowledge_rules')) {
      const inactiveRules = await db.collection('verified_knowledge_rules').find({ isActive: false }).toArray();
      for (const rule of inactiveRules) {
        const activeLinks = await db.collection('knowledge_rule_evidences').find({ ruleId: rule._id, status: 'active' }).toArray();
        if (activeLinks.length > 0) {
          integrityReports.push({
            type: 'inactive_rule_active_links',
            id: rule._id,
            details: `Rule '${rule.label}' is inactive but still has ${activeLinks.length} active evidence link(s)`
          });
        }
      }
    }

    // D. Candidates pointing to missing academic sources
    if (collectionNames.includes('pending_knowledge_rules')) {
      const candidates = await db.collection('pending_knowledge_rules').find({}).toArray();
      for (const cand of candidates) {
        const sourceExists = await db.collection('academic_sources').findOne({ _id: cand.academicSourceId });
        if (!sourceExists) {
          integrityReports.push({
            type: 'candidate_missing_source',
            id: cand._id,
            details: `Candidate '${cand.label}' points to non-existent academic source ID: ${cand.academicSourceId}`
          });
        }
      }
    }

    // E. Candidates pointing to missing chunks
    if (collectionNames.includes('pending_knowledge_rules')) {
      const candidates = await db.collection('pending_knowledge_rules').find({}).toArray();
      for (const cand of candidates) {
        if (cand.evidenceChunkIds && Array.isArray(cand.evidenceChunkIds)) {
          const missingChunkIds = [];
          for (const cid of cand.evidenceChunkIds) {
            const chunkExists = await db.collection('academic_chunks').findOne({ _id: cid });
            if (!chunkExists) {
              missingChunkIds.push(cid);
            }
          }
          if (missingChunkIds.length > 0) {
            integrityReports.push({
              type: 'candidate_missing_chunks',
              id: cand._id,
              details: `Candidate '${cand.label}' points to ${missingChunkIds.length} missing chunk(s): ${missingChunkIds.join(', ')}`
            });
          }
        }
      }
    }

    // F. source_generated rules without evidence links (identical check to B, but active/inactive agnostic)
    if (collectionNames.includes('verified_knowledge_rules')) {
      const genRules = await db.collection('verified_knowledge_rules').find({ origin: 'source_generated' }).toArray();
      for (const rule of genRules) {
        const totalLinks = await db.collection('knowledge_rule_evidences').countDocuments({ ruleId: rule._id });
        if (totalLinks === 0) {
          integrityReports.push({
            type: 'gen_rule_zero_links',
            id: rule._id,
            details: `Source generated rule '${rule.label}' has 0 evidence links`
          });
        }
      }
    }

    // G. Rejected candidates that still have active live rules
    if (collectionNames.includes('pending_knowledge_rules')) {
      const rejectedCands = await db.collection('pending_knowledge_rules').find({ status: 'rejected' }).toArray();
      for (const cand of rejectedCands) {
        if (cand.proposedRuleId) {
          const liveRule = await db.collection('verified_knowledge_rules').findOne({ _id: cand.proposedRuleId, isActive: true });
          if (liveRule) {
            integrityReports.push({
              type: 'rejected_candidate_active_rule',
              id: cand._id,
              details: `Candidate is rejected but proposed rule '${cand.proposedRuleId}' is active in knowledge_rules`
            });
          }
        }
      }
    }

    // H. Approved candidates without live KnowledgeRule
    if (collectionNames.includes('pending_knowledge_rules')) {
      const approvedCands = await db.collection('pending_knowledge_rules').find({ status: 'approved' }).toArray();
      for (const cand of approvedCands) {
        if (cand.proposedRuleId) {
          const ruleExists = await db.collection('verified_knowledge_rules').findOne({ _id: cand.proposedRuleId });
          if (!ruleExists) {
            integrityReports.push({
              type: 'approved_candidate_no_rule',
              id: cand._id,
              details: `Candidate status is approved but rule '${cand.proposedRuleId}' does not exist in knowledge_rules`
            });
          }
        }
      }
    }

    // I. Live KnowledgeRule records with origin values outside the allowed enum
    if (collectionNames.includes('verified_knowledge_rules')) {
      const rules = await db.collection('verified_knowledge_rules').find({}).toArray();
      const allowedOrigins = ['seed', 'source_generated', 'manual'];
      for (const rule of rules) {
        if (!allowedOrigins.includes(rule.origin)) {
          integrityReports.push({
            type: 'invalid_rule_origin',
            id: rule._id,
            details: `Rule has invalid origin value: '${rule.origin}'. Expected one of: ${allowedOrigins.join(', ')}`
          });
        }
      }
    }

    console.log(`\nFound ${integrityReports.length} Integrity Violations/Warnings:`);
    if (integrityReports.length === 0) console.log('  (None)');
    for (const report of integrityReports) {
      console.log(`  [INTEGRITY] Type: ${report.type} | ID: ${report.id} | ${report.details}`);
    }

    // ─── 3. APP BEHAVIOR IMPACT ASSESSMENT ───
    console.log('\n--- 3. VISIBLE APP BEHAVIOR IMPACT ASSESSMENT ---');
    
    let wouldImpactApp = false;
    const impactExplanation = [];

    // Check if any safe test records are linked to active systems
    for (const r of safeToDelete) {
      if (r.collection === 'verified_knowledge_rules') {
        const activeRule = await db.collection('verified_knowledge_rules').findOne({ _id: r.id, isActive: true });
        if (activeRule) {
          wouldImpactApp = true;
          impactExplanation.push(`- Active Rule [${r.id}]: Deleting it will immediately remove the rule "${activeRule.label}" from the active analysis database and library detail pages.`);
        }
      }
      if (r.collection === 'academic_sources') {
        // If it's a test source, is it linked to any live rule?
        const links = await db.collection('knowledge_rule_evidences').find({ sourceId: r.id, status: 'active' }).toArray();
        if (links.length > 0) {
          wouldImpactApp = true;
          impactExplanation.push(`- Academic Source [${r.id}]: Deleting it will orphan active evidence links for Rule IDs: [${links.map(l => l.ruleId).join(', ')}].`);
        }
      }
    }

    if (wouldImpactApp) {
      console.log('⚠️ WARNING: Deleting test namespace records WOULD affect visible app behavior:');
      for (const line of impactExplanation) {
        console.log(line);
      }
    } else {
      console.log('✅ Safe: Deleting the safe test namespace records will not affect active visible app behavior (only test/mock artifacts).');
    }

    // ─── 4. DRY-RUN CONCLUSION ───
    console.log('\n--- 4. DRY-RUN SUMMARY ---');
    console.log(`Safe test records scoped for deletion (when enabled): ${safeToDelete.length}`);
    console.log(`Suspicious records requiring review: ${suspiciousToReview.length}`);
    console.log(`Dangerous user/dream records (audit-only): ${dangerousAuditOnly.length}`);
    console.log(`Integrity reports generated: ${integrityReports.length}`);
    
    const args = process.argv.slice(2);
    const hasConfirmFlag = args.includes('--confirm-delete-test-only');

    if (hasConfirmFlag) {
      console.log('\n----------------------------------------------------------------');
      console.log('NOTE: --confirm-delete-test-only flag was provided.');
      if (!DELETE_ENABLED) {
        console.log('>>> DELETION IS STRICLY DISABLED FOR RUN 4. Running in dry-run mode only.');
      } else {
        console.log('>>> Deletion would execute in full mode.');
      }
      console.log('----------------------------------------------------------------');
    } else {
      console.log('\nRunning in standard dry-run report mode. No modifications attempted.');
    }

  } catch (err) {
    console.error('Audit run failed with error:', err);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB.');
    console.log('================================================================');
  }
}

run().catch(console.error);
