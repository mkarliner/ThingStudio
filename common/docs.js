
// FS.debug = true;
//
// Docs = new FS.Collection("docs", {
// 	stores: [new FS.Store.FileSystem("docs", {path: "~/twiddle"})]
// })
//
//
// Docs.allow({
//   insert: function(userId, doc) {
//     return true;
//   },
//   update: function(userId, doc, fieldNames, modifier) {
//     return true;
//   },
//   remove: function(userId, doc) {
//     return true;
//   },
//   download: function(userId) {
//     return true;
//   }
// });


Docs = new Meteor.Collection("docs");
DocChanges = new Meteor.Collection("doc_changes");

